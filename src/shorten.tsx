import { getModel } from "./raycast/preferences";
import { runNoViewCommand } from "./raycast/selection";

export default async function Command() {
  await runNoViewCommand("shorten", { model: getModel() });
}
