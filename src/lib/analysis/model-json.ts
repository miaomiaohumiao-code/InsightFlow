export class ModelJsonError extends SyntaxError {}
export function parseModelJson(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.trim())
    throw new ModelJsonError("模型返回空内容，未提供 JSON");
  let text = raw.trim().replace(/^\uFEFF/, "");
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelJsonError(
      `模型 JSON 语法错误（收到 ${text.length} 字符）；未保存本批结果`,
    );
  }
}
