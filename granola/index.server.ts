import type { PluginServerContext } from "@getpaseo/plugin/server";
import { browseNotes, listLocations, listPeople, noteAttachment, searchAttachments } from "./server/notes";
import { browseNotesRpc, listLocationsRpc, listPeopleRpc, noteAttachmentRpc, searchNotesRpc } from "./shared/notes";
import { granolaSettings } from "./shared/settings";
import { flush } from "./server/store";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(granolaSettings);
  server.handle(browseNotesRpc, (input) => browseNotes(input, settings));
  server.handle(listLocationsRpc, () => listLocations(settings));
  server.handle(listPeopleRpc, (input) => listPeople(input, settings));
  server.handle(noteAttachmentRpc, (input) => noteAttachment(input, settings));
  server.handle(searchNotesRpc, (input) => searchAttachments(input, settings));
  return () => flush();
}
