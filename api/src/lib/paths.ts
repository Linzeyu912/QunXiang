/**
 * 项目路径工具——用 import.meta.url 定位项目根目录，不依赖 process.cwd()。
 *
 * process.cwd() 取决于启动时的工作目录（从 api/ 启动 vs 从项目根启动结果不同），
 * import.meta.url 始终指向当前模块文件，路径推导更可靠。
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// api/src/lib/paths.ts → 上溯 4 级到项目根 D:\entity
const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);
export const PROJECT_ROOT = resolve(_dirname, '..', '..', '..');

/** 上传文件目录：{PROJECT_ROOT}/storage/uploads */
export const UPLOAD_DIR = resolve(PROJECT_ROOT, 'storage', 'uploads');

/** 实体图片目录：{PROJECT_ROOT}/storage/uploads/entity-images */
export const ENTITY_IMAGE_DIR = resolve(UPLOAD_DIR, 'entity-images');
