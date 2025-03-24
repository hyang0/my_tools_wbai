// 这个脚本需要在本地执行，不是扩展的一部分
// 它用于检查和创建保存目录

const fs = require('fs');
const path = require('path');

// 确保D:\test目录存在
const targetDir = 'D:\\test';

try {
  if (!fs.existsSync(targetDir)) {
    console.log(`创建目录: ${targetDir}`);
    fs.mkdirSync(targetDir, { recursive: true });
    console.log('目录创建成功！');
  } else {
    console.log(`目录 ${targetDir} 已存在。`);
  }
  
  // 确认目录可写
  const testFile = path.join(targetDir, 'test_write_permission.txt');
  fs.writeFileSync(testFile, 'Test write permission');
  fs.unlinkSync(testFile);
  console.log('目录可写，权限正常。');
  
  console.log('安装检查完成，扩展程序可以使用。');
} catch (error) {
  console.error('错误:', error.message);
  console.error('请确保您有足够的权限创建和写入目录 D:\\test');
} 