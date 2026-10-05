import { Action, ActionPanel, Icon, List, LocalStorage, closeMainWindow } from "@raycast/api";
import { useEffect, useState } from "react";
import { getModel } from "./raycast/preferences";
import { readSelection, reportError, runNoViewCommand } from "./raycast/selection";
import { orderTones, type Tone } from "./raycast/tones";

const LAST_TONE_KEY = "lastTone";

export default function Command() {
  const [selected, setSelected] = useState<string | undefined>();
  const [tones, setTones] = useState<Tone[]>(orderTones());
  const [loading, setLoading] = useState(true);

  // Capture selection on mount, before the user interacts with the list.
  useEffect(() => {
    (async () => {
      try {
        const last = await LocalStorage.getItem<string>(LAST_TONE_KEY);
        setTones(orderTones(last));
      } catch {
        // keep default order
      }
      try {
        setSelected(await readSelection());
      } catch (err) {
        await closeMainWindow();
        await reportError(err);
        return;
      }
      setLoading(false);
    })();
  }, []);

  async function pick(tone: Tone) {
    try {
      await LocalStorage.setItem(LAST_TONE_KEY, tone.id);
    } catch {
      // non-fatal
    }
    await runNoViewCommand(tone.mode, { model: getModel(), selected });
  }

  return (
    <List isLoading={loading} searchBarPlaceholder="Pick a tone">
      {!loading &&
        tones.map((tone) => (
          <List.Item
            key={tone.id}
            title={tone.title}
            icon={Icon.SpeechBubble}
            actions={
              <ActionPanel>
                <Action title={`Rewrite as ${tone.title}`} onAction={() => pick(tone)} />
              </ActionPanel>
            }
          />
        ))}
    </List>
  );
}
