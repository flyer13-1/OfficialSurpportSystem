/**
 * Node.js カスタムローダー
 * Lambda Layer のパス /opt/nodejs/ を
 * ローカルの layers/common/nodejs/ にリダイレクトする
 *
 * 起動方法:
 *   node --experimental-loader ./local-server/loader.mjs ./local-server/server.mjs
 */

import { fileURLToPath, pathToFileURL } from "url";
import { resolve as pathResolve, dirname } from "path";

// プロジェクトルートを基準に Layer パスを解決
const PROJECT_ROOT = pathToFileURL(
  pathResolve(dirname(fileURLToPath(import.meta.url)), "..")
).href;

const LAYER_BASE = `${PROJECT_ROOT}/layers/common/nodejs/`;

export function resolve(specifier, context, nextResolve) {
  // /opt/nodejs/xxx → layers/common/nodejs/xxx にリダイレクト
  if (specifier.startsWith("/opt/nodejs/")) {
    const file        = specifier.replace("/opt/nodejs/", "");
    const redirected  = LAYER_BASE + file;
    return nextResolve(redirected, context);
  }
  return nextResolve(specifier, context);
}
