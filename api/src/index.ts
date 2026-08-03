import 'dotenv/config';
import { buildApp } from './app.js';

async function start() {
  const fastify = await buildApp();
  // 默认 3001：本机 3000 常被其他项目占用（如 Omnitunes），与 start.bat / web 代理默认值保持一致。
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST;
  const address = await fastify.listen({ port, host });
  console.log(`服务已启动：${address}`);
}

start().catch((error) => {
  console.error('服务启动失败：', error);
  process.exitCode = 1;
});
