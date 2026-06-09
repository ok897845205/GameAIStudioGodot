import type { AssistantStreamChunk } from "../../AssistantStreamChunk";
import { promiseWithResolvers } from "../../../utils/promiseWithResolvers";

type MergeStreamItem = {
  reader: ReadableStreamDefaultReader<AssistantStreamChunk>;
  promise?: Promise<unknown> | undefined;
};

export const createMergeStream = () => {
  const list: MergeStreamItem[] = [];
  let sealed = false;
  let controller: ReadableStreamDefaultController<AssistantStreamChunk>;
  let currentPull: ReturnType<typeof promiseWithResolvers<void>> | undefined;

  const handlePull = (item: MergeStreamItem) => {
    if (!item.promise) {
      item.promise = item.reader
        .read()
        .then(({ done, value }) => {
          item.promise = undefined;
          if (done) {
            list.splice(list.indexOf(item), 1);
            if (sealed && list.length === 0) {
              controller.close();
            }
          } else {
            controller.enqueue(value);
          }

          currentPull?.resolve();
          currentPull = undefined;
        })
        .catch((e) => {
          console.error(e);

          list.forEach((item) => {
            item.reader.cancel();
          });
          list.length = 0;

          controller.error(e);

          currentPull?.reject(e);
          currentPull = undefined;
        });
    }
  };

  const readable = new ReadableStream<AssistantStreamChunk>({
    start(c) {
      controller = c;
    },
    pull() {
      currentPull = promiseWithResolvers();
      list.forEach((item) => {
        handlePull(item);
      });

      return currentPull.promise;
    },
    cancel() {
      list.forEach((item) => {
        item.reader.cancel();
      });
      list.length = 0;
    },
  });

  return {
    readable,
    isSealed() {
      return sealed;
    },
    seal() {
      sealed = true;
      if (list.length === 0) controller.close();
    },
    addStream(stream: ReadableStream<AssistantStreamChunk>) {
      if (sealed)
        throw new Error(
          "Cannot add streams after the run callback has settled.",
        );

      const item = { reader: stream.getReader() };
      list.push(item);
      handlePull(item);
    },
    enqueue(chunk: AssistantStreamChunk) {
      this.addStream(
        new ReadableStream({
          start(c) {
            c.enqueue(chunk);
            c.close();
          },
        }),
      );
    },
  };
};
