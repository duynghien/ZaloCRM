import { extractAttachmentContentInWorker, type AttachmentParseParams } from './attachment-parser.js';

process.once('message', (params: AttachmentParseParams) => {
  void extractAttachmentContentInWorker(params)
    .then((result) => process.send?.({ result }))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Attachment parser process failed';
      process.send?.({ error: message });
    });
});
