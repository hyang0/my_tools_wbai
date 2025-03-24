// 加载保存的设置
document.addEventListener('DOMContentLoaded', function() {
  // 获取保存目录输入框
  const directoryInput = document.getElementById('downloadDirectory');
  
  // 加载保存的设置
  chrome.storage.sync.get('downloadDirectory', function(data) {
    if (data.downloadDirectory) {
      directoryInput.value = data.downloadDirectory;
    } else {
      // 默认值
      directoryInput.value = 'D:\\test';
    }
  });
  
  // 保存按钮点击处理
  document.getElementById('saveSettings').addEventListener('click', function() {
    // 获取输入的下载目录
    const downloadDirectory = directoryInput.value.trim();
    
    // 验证目录格式
    if (!downloadDirectory) {
      showStatus('请输入有效的目录路径', 'error');
      return;
    }
    
    // 保存设置
    chrome.storage.sync.set({
      downloadDirectory: downloadDirectory
    }, function() {
      showStatus('设置已保存', 'success');
    });
  });
});

// 显示状态消息
function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status ' + type;
  status.style.display = 'block';
  
  // 3秒后自动隐藏消息
  setTimeout(function() {
    status.style.display = 'none';
  }, 3000);
} 