import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Real release signing (Step 12) — loaded from `android/key.properties`, a
// gitignored file that never exists in version control (see
// `android/.gitignore`). Never hardcode a store/key password here: this
// file only ever reads them from that untracked properties file, and the
// release build falls back to debug signing (with a loud Gradle warning,
// never silent) until it exists — so `flutter run`/local debug builds keep
// working unchanged before a real upload keystore is configured. See
// `android/key.properties.example` for the expected shape and
// `docs/STEP12_PROGRESS.md` for how to generate the keystore itself.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
val hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
} else {
    logger.warn(
        "XNAKView: android/key.properties not found — the release build type will be " +
            "signed with the DEBUG key and is NOT suitable for Google Play upload. " +
            "See android/key.properties.example.",
    )
}

android {
    namespace = "com.balochsahab.xnakview"
    // Real Face AR (Banuba SDK) pulls in transitive androidx dependencies
    // that require compiling against API 33-34 — confirmed via a real
    // Gradle dependency-constraint failure against Flutter's own default
    // when it resolved lower than that. Pinned explicitly rather than left
    // to Flutter's default so this doesn't silently regress on a Flutter
    // downgrade.
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // XNAKView's real, chosen application id — never changed from here.
        applicationId = "com.balochsahab.xnakview"
        // Real Face AR (Banuba SDK) requires minSdk 26 (Android 8.0) —
        // confirmed via a real Gradle manifest-merge failure against
        // Flutter's own default (24). Android 8.0+ covers the overwhelming
        // majority of active devices today, so this is a safe real bump,
        // not a cosmetic one.
        minSdk = 26
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Real upload-keystore signing once android/key.properties exists;
            // otherwise debug signing so local `flutter run --release` still
            // works (this build is then never uploadable to Play — see the
            // Gradle warning above).
            signingConfig = if (hasReleaseKeystore) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

// Real Face AR (Banuba SDK) — effect assets must physically live under the
// app's own assets/bnb-resources/effects (the native SDK's documented
// convention for `loadEffect("effects/<Name>", ...)`), copied here from
// mobile/banuba_effects rather than checked into the Android module
// directly, so the mobile project's asset source stays platform-agnostic.
tasks.register<Copy>("copyBanubaEffects") {
    from(rootProject.file("../banuba_effects"))
    into(layout.projectDirectory.dir("src/main/assets/bnb-resources/effects"))
}
tasks.named("preBuild") {
    dependsOn("copyBanubaEffects")
}

flutter {
    source = "../.."
}
