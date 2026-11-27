#!/bin/bash
# Build the sunsNoteBook Android APK from the PC app's web frontend.
# Same zero-dependency manual toolchain as the BabyWeather app:
# JDK in ~/jdk, Android SDK (platform 34 + build-tools 34.0.0) in ~/android-sdk.
export PATH="$HOME/jdk/bin:$PATH"
export JAVA_HOME="$HOME/jdk"
set -e
cd "$(dirname "$0")"
export ANDROID_HOME="$HOME/android-sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/34.0.0:$PATH"
test -f "$ANDROID_HOME/platforms/android-34/android.jar" || { echo "missing android.jar"; exit 1; }
BT="$ANDROID_HOME/build-tools/34.0.0"
PLAT="$ANDROID_HOME/platforms/android-34/android.jar"

# 1. stage the current web frontend as APK assets
mkdir -p app/src/main/assets
cp ../public/index.html ../public/app.js ../public/style.css app/src/main/assets/

mkdir -p build/gen build/obj build/apk build/dex
rm -rf build/gen/* build/obj/* build/apk/*

# 2. resources / manifest
"$BT/aapt2" compile --dir app/src/main/res -o build/res.zip
"$BT/aapt2" link -o build/apk/app-unsigned.apk -I "$PLAT" --manifest app/src/main/AndroidManifest.xml --java build/gen -A app/src/main/assets build/res.zip

# 3. compile java
find app/src/main/java build/gen -name "*.java" > build/sources.txt
javac -encoding UTF-8 -source 8 -target 8 -classpath "$PLAT" -d build/obj @build/sources.txt

# 4. dex
"$BT/d8" --lib "$PLAT" --output build/dex $(find build/obj -name "*.class")
cp build/dex/classes.dex build/apk/
cd build/apk && zip -q app-unsigned.apk classes.dex && cd ../..

# 5. align + sign (debug keystore, same convention as BabyWeather)
"$BT/zipalign" -f 4 build/apk/app-unsigned.apk build/apk/app-aligned.apk
if [ ! -f build/debug.keystore ]; then
  keytool -genkeypair -v -keystore build/debug.keystore -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=sunsNoteBook,O=Kalo,C=CN" >/dev/null 2>&1
fi
VER=$(grep -o '"version": "[^"]*"' ../package.json | grep -o '[0-9.]*')
"$BT/apksigner" sign --ks build/debug.keystore --ks-pass pass:android --key-pass pass:android --out sunsNoteBook.apk build/apk/app-aligned.apk
"$BT/apksigner" verify --verbose sunsNoteBook.apk
cp sunsNoteBook.apk "../dist/sunsNoteBook-v${VER}-android.apk"
ls -lh sunsNoteBook.apk "../dist/sunsNoteBook-v${VER}-android.apk"
echo BUILD_OK
