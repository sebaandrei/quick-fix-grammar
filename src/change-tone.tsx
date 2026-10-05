import { Action, ActionPanel, Icon, List, LocalStorage, PopToRootType, closeMainWindow } from "@raycast/api";
import { useEffect, useState } from "react";
import { getModel } from "./raycast/preferences";
import { readSelection, reportError, runNoViewCommand } from "./raycast/selection";
import { LAST_TONE_KEY, loadOrderedTones, orderTones, type Tone } from "./raycast/tones";

export default function Command() {
  const [selected, setSelected] = useState<string | undefined>();
  const [tones, setTones] = useState<Tone[]>(orderTones());
  const [loading, setLoading] = useState(true);

  // Capture selection on mount, before the user interacts with the list.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ordered = await loadOrderedTones((key) => LocalStorage.getItem<string>(key));
        const text = await readSelection();
        if (!mounted) return;
        setTones(ordered);
        setSelected(text);
      } catch (err) {
        // The error must reach the user even if closing the window fails.
        try {
          await closeMainWindow({ popToRootType: PopToRootType.Immediate });
        } catch (closeErr) {
          console.error("Could not close the window:", closeErr);
        }
        await reportError(err);
      } finally {
        if (mounted) setLoading(false);
      }
    })().catch((err) => console.error(err));
    return () => {
      mounted = false;
    };
  }, []);

  async function pick(tone: Tone) {
    if (selected === undefined) return;
    try {
      await LocalStorage.setItem(LAST_TONE_KEY, tone.id);
    } catch (err) {
      console.error("Could not save last tone:", err);
    }
    try {
      await runNoViewCommand(tone.mode, { model: getModel(), selected });
    } catch (err) {
      await reportError(err);
    }
  }

  return (
    <List isLoading={loading} searchBarPlaceholder="Pick a tone">
      {selected !== undefined &&
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
