# Schem Bench for Android

A WebView shell around the web app in [`../app`](../app). The shell exists to
provide the two things a browser tab cannot do on a phone: reach the world file
the user picks, and write a `.mcstructure` back somewhere they can find it.

## Build

```sh
ANDROID_SDK_ROOT=/path/to/sdk ./build.sh
```

Produces `build/Schem-Bench.apk`, signed and ready to install.

Needs a JDK and an Android SDK with `build-tools;35.0.0` and
`platforms;android-34`. No Gradle, no AndroidX, no network fetch at build time.

**Build-tools 35 is required, not just preferred.** The `d8` in 34.0.0 throws
`NullPointerException: Cannot invoke "String.length()"` on any class file
containing an anonymous inner class when run under JDK 21, because an anonymous
class carries a null `inner_name` in its `InnerClasses` attribute.

## How it works

| Concern | Approach |
|---|---|
| Serving the app | `shouldInterceptRequest` answers `https://schembench.local/` out of `assets/www`. A real https origin is needed because ES modules are blocked by CORS on `file://`. |
| Opening a world | `onShowFileChooser` → `ACTION_OPEN_DOCUMENT` with type `*/*`. Android greys out extensions it cannot map to a MIME type, so the page identifies the format from the file's own bytes instead. |
| Saving a structure | A `@JavascriptInterface` bridge takes base64 and writes to the shared Downloads collection on Android 10+, or through a save dialog below that. |
| Permissions | None. Reading is scoped to the picked file, writing needs no permission on modern Android, and every asset — fonts, three.js, JSZip — ships inside the APK. |

## Signing

`build.sh` generates `schembench.keystore` on first run if one is absent. That
key is fine for sideloading. Replace it with your own before distributing, or
Play Store uploads from a second machine will not match.
