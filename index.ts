import { nodes, state, root } from "membrane";
import * as util from "./util";
import { api, createAuthClient } from "./util";

export const Root = {
  authId() {
    return "google-docs";
  },
  async status() {
    return await util.authStatus();
  },
  parse({ args: { name, value } }) {
    switch (name) {
      case "documentUrl": {
        const id = value.match(
          new RegExp("/document/d/([a-zA-Z0-9-_]+)", "i")
        )?.[1];
        if (id) {
          return [root.documents.one({ id })];
        }
        break;
      }
    }
    return [];
  },
  documents: () => ({}),
  checkStatus: async () => {
    const res = await api("GET", "www.googleapis.com", `drive/v3/files`, {
      pageSize: 1,
    });
    return res.status === 200;
  },
};

export async function endpoint({ args: { path, query, headers, body } }) {
  const link = await nodes.http
    .authenticated({ api: "google-docs", authId: root.authId })
    .createLink.$invoke();
  switch (path) {
    case "/":
    case "/auth":
    case "/auth/":
    case "/auth/callback":
      return util.endpoint({ args: { path, query, headers, body }})
    default:
      return JSON.stringify({ status: 404, body: "Not found" });
  }
}

export async function configure({ args: { clientId, clientSecret } }) {
  state.clientId = clientId;
  state.clientSecret = clientSecret;
  await createAuthClient();
}

type ResolverInfo = {
  fieldNodes: {
    selectionSet: {
      selections: any;
    };
  }[];
};

// TODO
type Document = any;

// TODO: Perhaps we can use an ETAG to prevent getting the same content over and over
const apiGetDocument = async (id: string) => {
  const res = await api(
    "GET",
    "content-docs.googleapis.com",
    `v1/documents/${encodeURIComponent(id)}`
  );
  return await res.json();
};

// Determines if a query includes any fields that require fetching a given resource. Simple fields is an array of the
// fields that can be resolved without fetching
const shouldFetch = (info: ResolverInfo, simpleFields: string[]) =>
  info.fieldNodes
    .flatMap(({ selectionSet: { selections } }) => {
      return selections;
    })
    .some(({ name: { value } }) => !simpleFields.includes(value));

export const DocumentCollection = {
  async create({ args: { title, body } }) {
    const doc = { title, body: body && JSON.parse(body) };
    const res = await api("POST", "docs.googleapis.com", `v1/documents`, {}, JSON.stringify(doc));
    if (res.status >= 300) {
      throw new Error(`Error creating document: ${await res.text()}`);
    }
    const json = await res.json();
    return root.documents.one({ id: json.documentId });
  },
  async one({ args: { id }, context, info }) {
    context.documentId = id;
    if (!shouldFetch(info, ["id"])) {
      return { id };
    }
    return await apiGetDocument(id);
  },
  async page({ self, args }) {
    const { q: query, ...rest } = args;
    const mimeType = 'application/vnd.google-apps.document';
    const queryStr = query ? `and ${query}` : "";
    const q = `mimeType='${mimeType}' ${queryStr}`;
    const res = await api("GET", "www.googleapis.com", "/drive/v3/files", { ...rest, q });
    const json = await res.json();
    return { items: json.files, next: self.page({ ...rest, pageToken: json.nextPageToken }) };
  }
};

export const Document = {
  gref: ({ obj }) => {
    return root.documents.one({ id: obj?.id });
  },
  name: ({ obj }) => (obj?.title ? obj.title : obj.name),
  body: ({ obj }) => (obj?.body ? JSON.stringify(obj.body) : null),
  markdown: ({ obj }) => {
    return jsonToMarkdown(obj);
  },
  batchUpdate: async ({ args: { requests }, self }) => {
    const { id } = self.$argsAt(root.documents.one);
    const res = await api(
      "POST",
      "content-docs.googleapis.com",
      `v1/documents/${encodeURIComponent(id)}:batchUpdate`,
      {},
      requests
    );
    return await res.json();
  },
  replaceAllText: async ({ args: { text, replaceText, matchCase }, self }) => {
    const res = await applyUpdate(self, {
      replaceAllText: { containsText: { text, matchCase }, replaceText },
    });
    return res?.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
  },
  insertText: async ({ args: { text, segmentId, index }, self }) => {
    const req: any = { insertText: { text } };
    if (index != null) {
      req.insertText.location = { segmentId: segmentId || "", index };
    } else {
      req.insertText.endOfSegmentLocation = { segmentId: segmentId || "" };
    }
    await applyUpdate(self, req);
  },
  insertBullet: async ({ args: { text, index, bulletPreset }, self }) => {
    await self.insertText({ text: "\n" + text, index }).$invoke();

    const { id } = self.$argsAt(root.documents.one);
    let startIndex: number;
    if (index != null) {
      startIndex = index + 1;
    } else {
      const content = (await apiGetDocument(id))?.body?.content;
      startIndex = content?.[content.length - 1]?.endIndex - 1;
    }

    const range = { startIndex, endIndex: startIndex + 1, segmentId: "" };

    const req: any = {
      createParagraphBullets: {
        range,
        bulletPreset: bulletPreset ?? "BULLET_DISC_CIRCLE_SQUARE",
      },
    };
    await applyUpdate(self, req);
  },
  insertLink: async ({ args: { text, index, url }, self }) => {
    await self.insertText({ text, index }).$invoke();

    const { id } = self.$argsAt(root.documents.one);
    let endIndex: number;
    if (index != null) {
      endIndex = index + text.length;
    } else {
      const content = (await apiGetDocument(id))?.body?.content;
      endIndex = content?.[content.length - 1]?.endIndex - 1;
    }

    const range = {
      startIndex: endIndex - text.length,
      endIndex,
      segmentId: "",
    };
    const req: any = {
      updateTextStyle: { textStyle: { link: { url } }, range, fields: "link" },
    };
    await applyUpdate(self, req);
  },
};

async function applyUpdate(self: any, request: object): Promise<any> {
  const requests = { requests: [request] };
  const { id } = self.$argsAt(root.documents.one);
  const res = await api(
    "POST",
    "content-docs.googleapis.com",
    `v1/documents/${encodeURIComponent(id)}:batchUpdate`,
    {},
    JSON.stringify(requests)
  );
  if (res.status !== 200) {
    throw new Error(`Error applying update: ${await res.text()}`);
  }
  return await res.json();
}

// Taken from https://github.com/AnandChowdhary/docs-markdown/blob/6bd4f2f4d564bc9f225f03cdbcb42522c924cac3/index.ts
// It's not perfect but it's a start
const jsonToMarkdown = (file: any): string | null => {
  if (!file?.body?.content) {
    return null;
  }
  let text = `---
title: ${file.title}
documentId: ${file.documentId}
revisionId: ${file.revisionId}
---
`;
  file.body?.content?.forEach((item) => {
    /**
     * Tables
     */
    if (item.table?.tableRows) {
      // Make a blank header
      const cells = item.table.tableRows[0]?.tableCells;
      // Make a blank header
      text += `|${cells?.map(() => "").join("|")}|\n|${cells
        ?.map(() => "-")
        .join("|")}|\n`;
      item.table.tableRows.forEach(({ tableCells }) => {
        const textRows: string[] = [];
        tableCells?.forEach(({ content }) => {
          content?.forEach(({ paragraph }) => {
            const styleType =
              paragraph?.paragraphStyle?.namedStyleType || undefined;

            const e: string[] = paragraph?.elements?.map((element) =>
              styleElement(element, styleType)?.replace(/\n+/g, "").trim()
            );

            textRows.push(e.join(""));
          });
        });
        text += `| ${textRows.join(" | ")} |\n`;
      });
    }

    /**
     * Paragraphs and lists
     */
    if (item.paragraph && item.paragraph.elements) {
      const styleType =
        item?.paragraph?.paragraphStyle?.namedStyleType || undefined;
      const bullet = item.paragraph?.bullet;
      if (bullet?.listId) {
        const listDetails = file.lists?.[bullet.listId];
        const glyphFormat =
          listDetails?.listProperties?.nestingLevels?.[0].glyphFormat || "";
        const padding = "  ".repeat(bullet.nestingLevel || 0);
        if (["[%0]", "%0."].includes(glyphFormat)) {
          text += `${padding}1. `;
        } else {
          text += `${padding}- `;
        }
      }
      item.paragraph.elements.forEach((element) => {
        if (element.textRun && content(element) && content(element) !== "\n") {
          text += styleElement(element, styleType);
        }
      });
      text += bullet?.listId
        ? (text.split("\n").pop() || "").trim().endsWith("\n")
          ? ""
          : "\n"
        : "\n\n";
    }
  });

  const lines = text.split("\n");
  const linesToDelete: number[] = [];
  lines.forEach((line, index) => {
    if (index > 2) {
      if (
        !line.trim() &&
        ((lines[index - 1] || "").trim().startsWith("1. ") ||
          (lines[index - 1] || "").trim().startsWith("- ")) &&
        ((lines[index + 1] || "").trim().startsWith("1. ") ||
          (lines[index + 1] || "").trim().startsWith("- "))
      )
        linesToDelete.push(index);
    }
  });
  text = text
    .split("\n")
    .filter((_, i) => !linesToDelete.includes(i))
    .join("\n");
  return text.replace(/\n\s*\n\s*\n/g, "\n\n") + "\n";
};

const styleElement = (element: any, styleType?: string): string | undefined => {
  const text = content(element);
  if (!text || text.length === 0) {
    return "";
  }

  if (styleType === "TITLE") {
    return `# ${text}`;
  } else if (styleType === "SUBTITLE") {
    return ` _${text}_ `;
  } else if (styleType === "HEADING_1") {
    return `## ${text}`;
  } else if (styleType === "HEADING_2") {
    return `### ${text}`;
  } else if (styleType === "HEADING_3") {
    return `#### ${text}`;
  } else if (styleType === "HEADING_4") {
    return `##### ${text}`;
  } else if (styleType === "HEADING_5") {
    return `###### ${text}`;
  } else if (styleType === "HEADING_6") {
    return `####### ${text}`;
  } else if (
    element.textRun?.textStyle?.bold &&
    element.textRun?.textStyle?.italic
  ) {
    return ` **_${text}_** `;
  } else if (element.textRun?.textStyle?.italic) {
    return ` _${text}_ `;
  } else if (element.textRun?.textStyle?.bold) {
    return ` **${text}** `;
  }

  return text;
};

const content = (element: any): string | undefined => {
  const textRun = element?.textRun;
  const text = textRun?.content;
  if (textRun?.textStyle?.link?.url)
    return `[${text}]${textRun.textStyle.link.url}`;
  return text || undefined;
};
