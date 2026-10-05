import { levelToMode, getExtensionConfig, getModel } from "./raycast/preferences";
import { runNoViewCommand } from "./raycast/selection";

export default async function Command() {
  await runNoViewCommand(levelToMode(getExtensionConfig().level), { model: getModel() });
}
