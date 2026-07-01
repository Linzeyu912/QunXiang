import { createReadStream, statSync } from 'fs';
import { resolve } from 'path';
import http from 'http';

const FILE_PATH = 'D:/《斗破苍穹》.txt';
const API_URL = 'http://localhost:3000/books';

function getFileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

function uploadFile(filePath) {
  return new Promise((resolve, reject) => {
    const fileSize = getFileSize(filePath);
    if (fileSize === null) {
      reject(new Error(`文件不存在: ${filePath}`));
      return;
    }

    console.log(`文件大小: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`开始上传...`);

    // Build multipart form-data manually
    const boundary = '----FormBoundary' + Date.now();
    const pre = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodeURIComponent(filePath.split('/').pop())}"\r\nContent-Type: text/plain\r\n\r\n`,
      'utf-8'
    );
    const post = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/books',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'x-user-id': 'demo-user',
        'Content-Length': pre.length + fileSize + post.length,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log(`\nHTTP 状态码: ${res.statusCode}`);
        console.log(`响应头:`, JSON.stringify(res.headers, null, 2));
        try {
          const json = JSON.parse(data);
          console.log(`响应体 (JSON):`, JSON.stringify(json, null, 2));
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(json.error || `HTTP ${res.statusCode}: ${data}`));
          }
        } catch {
          console.log(`响应体 (原始):`, data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        }
      });
    });

    req.on('error', (err) => {
      console.error(`请求错误:`, err.message);
      reject(err);
    });

    req.write(pre);

    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      req.write(chunk);
    });
    stream.on('end', () => {
      req.write(post);
      req.end();
    });
    stream.on('error', (err) => {
      console.error(`文件读取错误:`, err.message);
      req.destroy();
      reject(err);
    });
  });
}

async function main() {
  console.log('=== 上传测试脚本 ===');
  console.log(`目标文件: ${FILE_PATH}`);

  const fileSize = getFileSize(FILE_PATH);
  if (fileSize === null) {
    console.error('文件不存在，请确认路径正确');
    process.exit(1);
  }

  const startTime = Date.now();
  try {
    const result = await uploadFile(FILE_PATH);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ 上传成功！耗时 ${duration} 秒`);
    console.log(`返回数据:`, JSON.stringify(result, null, 2));
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n❌ 上传失败！耗时 ${duration} 秒`);
    console.error(`错误信息:`, err.message);

    // 分析错误类型
    if (err.message.includes('ECONNREFUSED')) {
      console.error('\n💡 诊断: 后端 API 未启动 (端口 3000)');
    } else if (err.message.includes('Parse')) {
      console.error('\n💡 诊断: 文件解析失败，可能是编码问题');
    } else if (err.message.includes('limit') || err.message.includes('payload')) {
      console.error('\n💡 诊断: 文件大小超过限制');
    } else {
      console.error('\n💡 诊断: 未知错误，请查看后端日志');
    }
  }
}

main();
