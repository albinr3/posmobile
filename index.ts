import * as WebBrowser from 'expo-web-browser';
import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';

import App from './App';

WebBrowser.maybeCompleteAuthSession();

if (__DEV__) {
  // Emitted by @react-navigation/stack on React Native 0.83+.
  LogBox.ignoreLogs([
    'InteractionManager has been deprecated',
    "Please refactor long tasks into smaller ones, and use 'requestIdleCallback' instead.",
  ]);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
