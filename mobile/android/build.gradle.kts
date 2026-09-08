// Real Face AR (Banuba SDK) — the banuba_sdk plugin's own android/build.gradle
// reads this native SDK version via `$project.bnb_sdk_version`; it also
// registers Banuba's Maven repo on `rootProject.allprojects` itself, so no
// extra repository entry is needed here.
extra["bnb_sdk_version"] = "1.18.+"

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// Some third-party Android library modules (e.g. flutter_facebook_auth) don't
// pin their own Java/Kotlin compile targets, so they fall back to whatever
// the installed JDK defaults to — which can drift from the Kotlin toolchain's
// default and fail with "Inconsistent JVM Target Compatibility Between Java
// and Kotlin Tasks". Force every module (app included, redundantly but
// harmlessly) onto the same Java 17 target the app itself already uses.
subprojects {
    val applyConsistentJvmTargets: () -> Unit = {
        extensions.findByType(com.android.build.gradle.LibraryExtension::class.java)?.apply {
            compileOptions {
                sourceCompatibility = JavaVersion.VERSION_17
                targetCompatibility = JavaVersion.VERSION_17
            }
        }
        tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
            compilerOptions {
                jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
            }
        }
    }
    // Flutter's own build ordering (evaluationDependsOn(":app") above)
    // already evaluates some subprojects before this block runs, and
    // Project.afterEvaluate throws on an already-evaluated project — so
    // apply immediately for those, and defer for the rest.
    if (state.executed) applyConsistentJvmTargets() else afterEvaluate { applyConsistentJvmTargets() }
}

// Real Face AR (Banuba SDK) — the published banuba_sdk 3.1.6 plugin's own
// Android library module pins compileSdkVersion 31 internally (confirmed by
// reading its android/build.gradle in the pub cache), which fails a real
// Gradle/AGP dependency-version check: several transitive androidx
// artifacts already pulled in by this project's OTHER native plugins
// (camera/livekit_client/flutter_webrtc) require any consuming module to
// compile against API 33+. Raising THIS project's own app-level compileSdk
// does not fix it — the failing check is specifically about the
// `:banuba_sdk` library module's OWN declared level. This overrides just
// that one subproject's compileSdk, the same targeted-subproject pattern
// already used above for JVM target alignment — not a project-wide
// resolutionStrategy hack, and it touches no other module's build.
subprojects {
    if (project.name == "banuba_sdk") {
        val applyBanubaCompileSdk: () -> Unit = {
            extensions.findByType(com.android.build.gradle.LibraryExtension::class.java)?.apply {
                compileSdk = 36
            }
        }
        if (state.executed) applyBanubaCompileSdk() else afterEvaluate { applyBanubaCompileSdk() }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
