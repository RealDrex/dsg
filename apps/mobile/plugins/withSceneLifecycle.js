/**
 * iOS 27 asserts at launch unless the app adopts the UIScene life cycle
 * (crash: _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
 * Expo ships `ExpoAppSceneDelegate` (Objective-C name `EXExpoAppSceneDelegate`) for this;
 * this plugin registers it in Info.plist and lets it start React Native in the scene's window.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_DELEGATE = 'EXExpoAppSceneDelegate';

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: SCENE_DELEGATE },
        ],
      },
    };
    return cfg;
  });
}

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle: expected a Swift AppDelegate');
    }
    let src = cfg.modResults.contents;
    // 1) The app delegate provides the factory; the scene delegate owns the window.
    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      src = src.replace(/class AppDelegate: ExpoAppDelegate \{/, 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    }
    // 2) Don't create a window or start React Native here; ExpoAppSceneDelegate does it per scene.
    src = src.replace(
      /#if os\(iOS\) \|\| os\(tvOS\)\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*factory\.startReactNative\([\s\S]*?\)\s*#endif\s*/,
      '// React Native is started by ExpoAppSceneDelegate (UIScene life cycle, required on iOS 27).\n' +
        '    // Referencing the class keeps it linked; Info.plist names it as the scene delegate.\n' +
        '    _ = ExpoAppSceneDelegate.self\n\n    ',
    );
    if (src.includes('UIWindow(frame: UIScreen.main.bounds)')) {
      throw new Error('withSceneLifecycle: could not update AppDelegate.swift; the Expo template changed');
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withSceneAppDelegate(withSceneManifest(config));
};
