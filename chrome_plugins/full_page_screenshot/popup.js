// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', function() {
  // 获取界面元素
  const captureButton = document.getElementById('captureButton');
  const savePathElement = document.getElementById('savePath');
  const settingsLink = document.getElementById('settingsLink');
  const toggleTroubleshoot = document.getElementById('toggleTroubleshoot');
  const troubleshootInfo = document.getElementById('troubleshootInfo');
  
  console.log('Popup初始化完成，设置事件监听器');
  
  // 标记按钮是否已经点击过，防止重复点击
  let isCaptureInProgress = false;
  
  // 加载保存路径设置
  chrome.storage.sync.get('downloadDirectory', function(data) {
    const directory = data.downloadDirectory || 'D:\\test';
    savePathElement.textContent = `保存到: ${directory}`;
    
    // 检查目录是否存在（仅用于显示目的）
    checkDirectoryExists(directory);
  });
  
  // 为截图按钮添加点击事件监听器
  captureButton.addEventListener('click', function() {
    // 避免重复点击
    if (isCaptureInProgress) {
      console.log('已经在进行截图，忽略重复点击');
      return;
    }
    
    console.log('捕获按钮被点击，准备发送消息');
    
    // 设置标记，防止重复点击
    isCaptureInProgress = true;
    
    // 禁用按钮，避免重复点击
    captureButton.disabled = true;
    captureButton.textContent = '正在截图...';
    
    // 先发送初始化消息并确认background.js已准备好
    chrome.runtime.sendMessage({ 
      action: 'prepareCapture',
      timestamp: Date.now()
    }, function(response) {
      console.log('准备消息响应:', response);
      
      if (response && response.ready) {
        // background.js已准备好，现在发送实际截图命令
        chrome.runtime.sendMessage({ 
          action: 'captureFullPage',
          timestamp: Date.now() 
        }, function(captureResponse) {
          console.log('截图命令响应:', captureResponse);
          
          // 延迟关闭窗口，确保命令已经被处理
          setTimeout(() => {
            window.close();
          }, 500);
        });
      } else {
        // 恢复按钮状态
        captureButton.disabled = false;
        captureButton.textContent = '捕获整页长截图';
        isCaptureInProgress = false;
        
        // 显示错误信息
        alert('扩展无法启动截图功能，请重试');
      }
    });
  });
  
  // 为设置链接添加点击事件
  settingsLink.addEventListener('click', function() {
    // 打开选项页面
    chrome.runtime.openOptionsPage();
  });
  
  // 为问题诊断切换添加点击事件
  toggleTroubleshoot.addEventListener('click', function() {
    if (troubleshootInfo.style.display === 'block') {
      troubleshootInfo.style.display = 'none';
      toggleTroubleshoot.textContent = '截图失败？点击查看解决方法';
    } else {
      troubleshootInfo.style.display = 'block';
      toggleTroubleshoot.textContent = '收起解决方法';
    }
  });
  
  // 检查当前打开的标签页是否可以截图
  checkCurrentTab();
});

// 检查当前标签页是否可以截图
function checkCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs || tabs.length === 0) return;
    
    const activeTab = tabs[0];
    const url = activeTab.url || '';
    
    console.log('检查当前标签页:', url);
    
    // 检查URL类型（chrome://、chrome-extension://等不可截图）
    if (url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('devtools://') ||
        url.startsWith('about:')) {
      
      const captureButton = document.getElementById('captureButton');
      captureButton.disabled = true;
      captureButton.title = '当前页面类型不支持截图';
      
      const noteElement = document.querySelector('.note');
      noteElement.textContent = '当前页面类型不支持截图，请在常规网页上使用';
      noteElement.style.color = '#e53935';
    }
  });
}

// 检查目录是否存在
function checkDirectoryExists(directory) {
  // 注意：由于浏览器安全限制，我们无法直接检查本地目录
  // 此处仅作提示用途
  const savePathElement = document.getElementById('savePath');
  
  savePathElement.innerHTML = `保存到: ${directory} <span style="font-style: italic; font-size: 11px;">(请确保目录存在)</span>`;
} 