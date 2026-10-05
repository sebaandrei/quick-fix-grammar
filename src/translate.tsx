import { getModel, getTargetLanguage } from "./raycast/preferences";
import { runNoViewCommand } from "./raycast/selection";

export default async function Command() {
  await runNoViewCommand("translate", { model: getModel(), targetLanguage: getTargetLanguage() });
}
