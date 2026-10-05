import { getPreferenceValues } from "@raycast/api";
import { buildConfig, modelFor, targetLanguageFor, type ExtensionConfig } from "./resolve";

export { levelToMode, validateConfig, type ExtensionConfig } from "./resolve";

export const getExtensionConfig = (): ExtensionConfig => buildConfig(getPreferenceValues<ExtensionPreferences>());

/** All commands share the `model` pref name. */
export const getModel = () => modelFor(getPreferenceValues<ExtensionPreferences & { model?: string }>());

export const getTargetLanguage = () =>
  targetLanguageFor(getPreferenceValues<ExtensionPreferences & { targetLanguage?: string }>());
