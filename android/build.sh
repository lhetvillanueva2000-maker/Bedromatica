#!/usr/bin/env bash
#
# Builds Schem Bench.apk without Gradle.
#
# Gradle would work, but it wants a network round trip for the Android plugin
# and its transitive dependencies on every clean machine. The app has no
# libraries at all - one activity, no AndroidX - so driving aapt2/javac/d8/
# apksigner directly is both faster and far easier to debug when a step fails.
#
# Needs: ANDROID_SDK_ROOT pointing at an SDK with build-tools and a platform.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"

SDK="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
BUILD_TOOLS="${BUILD_TOOLS:-35.0.0}"
PLATFORM="${PLATFORM:-android-34}"
MIN_SDK="${MIN_SDK:-24}"
TARGET_SDK="${TARGET_SDK:-34}"

BT="$SDK/build-tools/$BUILD_TOOLS"
ANDROID_JAR="$SDK/platforms/$PLATFORM/android.jar"
OUT="$HERE/build"
APK_NAME="${APK_NAME:-Schem-Bench.apk}"

for tool in "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner"; do
  [ -x "$tool" ] || { echo "Missing $tool" >&2; exit 1; }
done
[ -f "$ANDROID_JAR" ] || { echo "Missing $ANDROID_JAR" >&2; exit 1; }

echo "==> Clean"
rm -rf "$OUT"
mkdir -p "$OUT/res" "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/assets/www"

echo "==> Stage the web app into assets/www"
# Everything the page needs, and nothing that only matters to the web build.
( cd "$ROOT/app" && find . -type f \
    ! -name 'sw.js' \
    ! -name '*.map' \
    -print0 | tar --null -cf - -T - ) | ( cd "$OUT/assets/www" && tar -xf - )
echo "    $(find "$OUT/assets/www" -type f | wc -l) files staged"

echo "==> Compile resources"
"$BT/aapt2" compile --dir "$HERE/res" -o "$OUT/res/resources.zip"

echo "==> Link"
"$BT/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$HERE/AndroidManifest.xml" \
  --java "$OUT/gen" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  -A "$OUT/assets" \
  --auto-add-overlay \
  "$OUT/res/resources.zip"

echo "==> Compile Java"
# Release 8 keeps the bytecode plain - no nestmates, no invokedynamic - which
# is the widest thing d8 will accept and costs this app nothing.
#
# Build-tools 35 is required, not preferred: the d8 shipped in 34.0.0 throws
# "Cannot invoke String.length()" on any anonymous class when run under JDK 21,
# because an anonymous class has a null inner_name in its InnerClasses entry.
find "$HERE/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -nowarn -encoding UTF-8 --release 8 \
  -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" \
  @"$OUT/sources.txt"

echo "==> Dex"
"$BT/d8" --release --lib "$ANDROID_JAR" --min-api "$MIN_SDK" \
  --classpath "$OUT/classes" \
  --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class')

echo "==> Assemble"
cp "$OUT/base.apk" "$OUT/unaligned.apk"
( cd "$OUT/dex" && zip -q -j "$OUT/unaligned.apk" classes.dex )

echo "==> Align"
"$BT/zipalign" -f -p 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

echo "==> Sign"
KEYSTORE="${KEYSTORE:-$HERE/schembench.keystore}"
STOREPASS="${STOREPASS:-schembench}"
if [ ! -f "$KEYSTORE" ]; then
  echo "    generating a signing key"
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -storepass "$STOREPASS" -keypass "$STOREPASS" \
    -alias schembench \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Schem Bench, OU=Bedromatica, O=Usersainyy, C=US" >/dev/null 2>&1
fi

"$BT/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-pass "pass:$STOREPASS" \
  --key-pass "pass:$STOREPASS" \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$OUT/$APK_NAME" \
  "$OUT/aligned.apk"

echo "==> Verify"
"$BT/apksigner" verify --print-certs "$OUT/$APK_NAME" | head -4
ls -la "$OUT/$APK_NAME"
echo
echo "Built $OUT/$APK_NAME"
