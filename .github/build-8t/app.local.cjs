// Expo config overrides for the Happier 8T Android build (.github/workflows/build-8t-app.yml).
// apps/ui/app.config.js loads this file through EXPO_APP_LOCAL_CONFIG_PATH and deep-merges `expo`.
// Name, package and default server come from env vars that app.config.js and the app already read.

const versionCode = Number.parseInt(String(process.env.HAPPIER_8T_VERSION_CODE ?? ''), 10);
const googleServicesFile = String(process.env.HAPPIER_8T_GOOGLE_SERVICES_FILE ?? '').trim();

module.exports = {
    expo: {
        // The upstream EAS project serves OTA updates for the same runtime version and channel.
        // An OTA update would replace this bundle and its default server, so the build never checks.
        updates: {
            enabled: false,
            checkAutomatically: 'NEVER',
        },
        android: {
            // A higher versionCode per run lets each APK install over the previous one.
            ...(Number.isInteger(versionCode) && versionCode > 0 ? { versionCode } : {}),
            // A copy of google-services.json with a client entry for this package name.
            ...(googleServicesFile ? { googleServicesFile } : {}),
        },
    },
};
