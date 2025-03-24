// 这个脚本直接注入到页面中
// 我们可以在这里添加额外的打印设置和功能
console.log('PDF Printer extension loaded');

// 接收来自background.js的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "prepareForPrint") {
    try {
      // 只做必要的打印前准备，不添加任何可见元素
      // 如果有特殊打印设置，可以在这里设置，但不要修改页面内容

      // 响应准备完成
      sendResponse({ success: true });
    } catch (error) {
      console.error("打印准备错误:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // 保持消息通道开放以进行异步响应
  }
});

// 监听来自iframe的打印完成消息
window.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'pdf_printed') {
    console.log('PDF打印完成');
  }
});

// 如果需要自定义打印设置可以在这里添加 

console.log('Full Page Screenshot extension loaded');

// 存储滚动状态
let originalScrollData = {
  top: 0,
  left: 0,
  isStored: false
};

// 存储可能被隐藏的固定元素
let hiddenElements = [];

// 页面是否正在被捕获的标志
let isCapturing = false;

// 监听背景页的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    console.log('Content script received message:', message.action);
    
    // 页面信息获取请求
    if (message.action === 'prepareForCapture') {
      if (isCapturing) {
        console.warn('已经在进行截图，忽略重复请求');
        sendResponse({ success: false, error: '已经在进行截图' });
        return true;
      }
      
      // 标记捕获状态
      isCapturing = true;
      window.isCapturingFullPage = true;
      
      // 保存滚动位置
      saveScrollPosition();
      
      // 隐藏固定元素
      const hiddenCount = hideFixedElements();
      console.log(`已隐藏 ${hiddenCount} 个固定元素`);
      
      // 获取页面尺寸
      const dimensions = getPageDimensions();
      
      // 滚动到页面顶部
      window.scrollTo(0, 0);
      
      // 发送页面信息给background
      setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'pageInfo',
          data: dimensions
        });
      }, 100);
      
      sendResponse({ 
        success: true,
        dimensions: dimensions,
        hiddenElements: hiddenCount
      });
    }
    // 清理请求
    else if (message.action === 'cleanupCapture') {
      const result = cleanupCaptureState();
      sendResponse({ success: result });
    }
    else {
      // 通用响应处理
      sendResponse({ success: true });
    }
  } catch (e) {
    console.error('Error handling message:', e);
    isCapturing = false;
    window.isCapturingFullPage = false;
    sendResponse({ success: false, error: e.message });
  }
  return true;
});

// 禁止在截图过程中滚动页面
document.addEventListener('scroll', function(e) {
  if (window.isCapturingFullPage) {
    console.log('阻止用户滚动，正在截图中');
    // 如果正在截图中，阻止用户滚动
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
});

// 隐藏固定定位的元素（可能会在多个截图中重复出现）
function hideFixedElements() {
  try {
    console.log('隐藏固定定位元素');
    hiddenElements = [];
    
    // 使用更高效的方法
    const allElements = document.body.getElementsByTagName('*');
    let count = 0;
    
    // 分批处理元素，防止长时间阻塞
    for (let i = 0; i < allElements.length; i++) {
      try {
        const element = allElements[i];
        const style = window.getComputedStyle(element);
        
        if (style && (style.position === 'fixed' || style.position === 'sticky')) {
          const originalDisplay = style.display;
          
          // 存储元素信息以便恢复
          hiddenElements.push({
            element: element,
            originalDisplay: originalDisplay
          });
          
          // 隐藏元素
          element.style.display = 'none';
          count++;
          
          // 每处理50个元素允许浏览器响应其他事件
          if (count % 50 === 0) {
            console.log(`已处理 ${count} 个固定元素`);
          }
        }
      } catch (err) {
        // 忽略单个元素的处理错误
      }
    }
    
    console.log(`成功隐藏了 ${hiddenElements.length} 个固定定位元素`);
    return hiddenElements.length;
  } catch (e) {
    console.error('隐藏固定元素失败:', e);
    return 0;
  }
}

// 恢复固定定位元素的显示
function showFixedElements() {
  try {
    console.log('恢复固定定位元素显示');
    if (!hiddenElements || !hiddenElements.length) {
      console.log('没有需要恢复的元素');
      return 0;
    }
    
    let restoredCount = 0;
    
    // 分批恢复，防止阻塞
    for (let i = 0; i < hiddenElements.length; i++) {
      try {
        const item = hiddenElements[i];
        if (item && item.element) {
          item.element.style.display = item.originalDisplay || '';
          restoredCount++;
          
          // 每恢复50个元素允许浏览器响应
          if (restoredCount % 50 === 0) {
            console.log(`已恢复 ${restoredCount} 个元素`);
          }
        }
      } catch (err) {
        // 忽略单个元素恢复错误
      }
    }
    
    console.log(`成功恢复了 ${restoredCount} 个固定定位元素`);
    hiddenElements = []; // 清空列表
    return restoredCount;
  } catch (e) {
    console.error('恢复固定元素失败:', e);
    return 0;
  }
}

// 保存当前滚动位置
function saveScrollPosition() {
  try {
    originalScrollData.top = window.scrollY || document.documentElement.scrollTop;
    originalScrollData.left = window.scrollX || document.documentElement.scrollLeft;
    originalScrollData.isStored = true;
    
    console.log('保存滚动位置:', originalScrollData);
    return true;
  } catch (e) {
    console.error('保存滚动位置失败:', e);
    return false;
  }
}

// 恢复保存的滚动位置
function restoreScrollPosition() {
  try {
    if (!originalScrollData.isStored) {
      console.log('没有保存的滚动位置可恢复');
      return false;
    }
    
    window.scrollTo(originalScrollData.left, originalScrollData.top);
    console.log('恢复滚动位置到:', originalScrollData);
    
    // 重置存储标志
    originalScrollData.isStored = false;
    return true;
  } catch (e) {
    console.error('恢复滚动位置失败:', e);
    return false;
  }
}

// 如果截图过程被中断，这个函数可以清理页面状态
function cleanupCaptureState() {
  try {
    console.log('清理截图状态');
    
    // 重置状态标志
    isCapturing = false;
    window.isCapturingFullPage = false;
    
    // 恢复滚动位置
    restoreScrollPosition();
    
    // 恢复固定元素
    showFixedElements();
    
    return true;
  } catch (e) {
    console.error('清理截图状态失败:', e);
    
    // 紧急重置所有状态
    try {
      isCapturing = false;
      window.isCapturingFullPage = false;
    } catch (ex) {}
    
    return false;
  }
}

// 在页面卸载或刷新前确保恢复页面状态
window.addEventListener('beforeunload', cleanupCaptureState);

// 获取页面尺寸信息，增强版
function getPageDimensions() {
  try {
    // 获取文档尺寸的多种方法
    const dims = {
      // 页面总高度（滚动高度）
      scrollHeight: Math.max(
        document.body ? document.body.scrollHeight : 0, 
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.offsetHeight : 0,
        document.documentElement ? document.documentElement.offsetHeight : 0
      ),
      
      // 页面总宽度（滚动宽度）
      scrollWidth: Math.max(
        document.body ? document.body.scrollWidth : 0, 
        document.documentElement ? document.documentElement.scrollWidth : 0,
        document.body ? document.body.offsetWidth : 0,
        document.documentElement ? document.documentElement.offsetWidth : 0
      ),
      
      // 视口高度
      windowHeight: window.innerHeight || 
                   (document.documentElement ? document.documentElement.clientHeight : 0) || 
                   (document.body ? document.body.clientHeight : 0),
      
      // 视口宽度
      windowWidth: window.innerWidth || 
                  (document.documentElement ? document.documentElement.clientWidth : 0) || 
                  (document.body ? document.body.clientWidth : 0)
    };
    
    // 对异常值进行修正
    if (dims.scrollHeight <= 0 || isNaN(dims.scrollHeight)) {
      dims.scrollHeight = Math.max(
        document.body ? document.body.getBoundingClientRect().height : 0,
        document.documentElement ? document.documentElement.getBoundingClientRect().height : 0,
        1000 // 最小高度
      );
    }
    
    if (dims.windowHeight <= 0 || isNaN(dims.windowHeight)) {
      dims.windowHeight = 600; // 默认视口高度
    }
    
    // 添加一些额外空间以确保捕获完整内容
    dims.pageHeight = dims.scrollHeight + 100;
    
    console.log('页面尺寸信息:', dims);
    return dims;
  } catch (e) {
    console.error('获取页面尺寸失败:', e);
    
    // 返回默认值
    return {
      scrollHeight: 5000,
      scrollWidth: 1200,
      windowHeight: 600,
      windowWidth: 1200,
      pageHeight: 5100
    };
  }
} 