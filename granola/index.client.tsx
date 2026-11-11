import type { PluginClientContext } from "@getpaseo/plugin/client";
import { GranolaComposerItem } from "./client/composer-item";
import { GranolaSettings } from "./client/settings";
import { noteAttachments } from "./shared/notes";

export default function contribute(client: PluginClientContext) {
  // Required for composer.addAttachment; it also adds "Granola" to the composer's "+" menu.
  client.addAttachmentSource(noteAttachments);
  client.addComposerItem({ id: "granola-transcript", Component: GranolaComposerItem });
  client.addSettingsScreen({ id: "granola", title: "Granola", icon: "KeyRound", Component: GranolaSettings });
  return () => {};
}
