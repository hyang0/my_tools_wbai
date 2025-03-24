// 添加调试模式标志
const DEBUG_MODE = true; // 设置为true开启调试模式

// 添加详细调试设置
const DEBUG_SETTINGS = {
  saveIntermediateScreenshots: true, // 是否保存中间截图
  showDebugNotifications: true,      // 是否显示调试通知
  logToConsole: true                // 是否在控制台输出调试信息
};

// 全局状态，跟踪是否有截图正在进行
let captureInProgress = false;

// 添加截图限流控制变量
const MIN_CAPTURE_INTERVAL = 1000; // 每次截图之间的最小间隔(毫秒)
let lastCaptureTime = 0;
let captureRetryCount = 0;
const MAX_CAPTURE_RETRIES = 3;

// 监听键盘命令
chrome.commands.onCommand.addListener((command) => {
  if (command === 'print-to-pdf') {
    // 检查是否已经有截图任务在进行
    if (captureInProgress) {
      console.log('已有截图任务正在进行，忽略本次请求');
      showNotification('请稍等', '已有截图任务正在进行');
      return;
    }
    
    // 获取当前活动标签页
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      
      // 调用函数进行长截图
      captureFullPage(activeTab);
    });
  }
});

// 监听来自popup的消息
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  console.log('接收到消息:', message);
  
  // 初始化准备阶段
  if (message.action === 'prepareCapture') {
    // 检查是否已经有截图任务在进行
    if (captureInProgress) {
      console.log('已有截图任务正在进行，通知popup');
      sendResponse({ ready: false, error: '已有截图任务正在进行' });
      return true; // 表示异步响应
    }
    
    // 准备进行截图操作
    try {
      prepareForCapture();
      console.log('初始化成功，通知popup准备就绪');
      sendResponse({ ready: true });
    } catch (error) {
      console.error('准备截图失败:', error);
      sendResponse({ ready: false, error: error.message });
    }
    
    return true; // 表示异步响应
  }
  
  // 执行截图命令
  if (message.action === 'captureFullPage') {
    console.log('收到截图命令');
    
    // 重置状态
    captureInProgress = false;
    
    // 获取当前活动标签页并执行截图
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        console.error('无法获取当前标签页');
        sendResponse({ success: false, error: '无法获取当前标签页' });
        return;
      }
      
      const activeTab = tabs[0];
      console.log('准备对标签页进行截图:', activeTab.id);
      
      // 获取保存目录
      getDownloadDirectory((directory) => {
        if (!directory) {
          console.error('无法获取保存目录');
          sendResponse({ success: false, error: '无法获取保存目录' });
          return;
        }
        
        // 初始化变量
        let capturedImages = [];
        let currentScrollPosition = 0;
        let pageInfo = null;
        let scrollAttempts = 0;
        const MAX_SCROLL_ATTEMPTS = 3;
        
        try {
          // 直接开始截图过程
          captureFullPage(activeTab, {
            directory,
            capturedImages,
            currentScrollPosition,
            pageInfo,
            scrollAttempts,
            MAX_SCROLL_ATTEMPTS
          });
          
          // 返回成功启动的消息
          sendResponse({ success: true, message: '截图过程已启动' });
        } catch (error) {
          console.error('启动截图过程失败:', error);
          sendResponse({ success: false, error: '启动截图失败: ' + error.message });
        }
      });
    });
    
    return true; // 表示异步响应
  }
  
  // 返回false表示同步处理完成
  return false;
});

// 获取用户设置的保存目录
function getDownloadDirectory(callback) {
  chrome.storage.sync.get('downloadDirectory', function(data) {
    const directory = data.downloadDirectory || 'D:\\test';
    callback(directory);
  });
}

// 显示通知
function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'images/icon128.png',
    title: title,
    message: message,
    priority: 2
  });
}

// 在截图过程中保存调试信息和中间结果
function saveDebugData(data, filename, type, directory) {
  if (!DEBUG_MODE) return;
  
  // 确保文件名没有特殊字符
  const safeFilename = filename.replace(/[^a-zA-Z0-9_\-]/g, '_');
  
  // 生成完整文件名，包含时间戳
  const timestamp = Date.now();
  const fullFilename = `${safeFilename}_${timestamp}`;
  
  // 根据类型处理数据
  if (type === 'json') {
    // 对于JSON数据，添加时间戳和元数据
    const jsonData = {
      timestamp: new Date().toISOString(),
      data: data
    };
    
    // 转换为字符串
    const jsonStr = JSON.stringify(jsonData, null, 2);
    
    // 创建Blob
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // 保存文件
    chrome.downloads.download({
      url: url,
      filename: `debug/${fullFilename}.json`,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      // 清理URL
      URL.revokeObjectURL(url);
      
      if (chrome.runtime.lastError) {
        console.error('保存调试JSON失败:', chrome.runtime.lastError);
      } else if (DEBUG_SETTINGS.logToConsole) {
        console.log(`调试JSON已保存: debug/${fullFilename}.json`);
      }
    });
  } else if (type === 'image' && typeof data === 'string' && data.startsWith('data:')) {
    // 对于图像数据URL，直接保存
    chrome.downloads.download({
      url: data,
      filename: `debug/${fullFilename}.png`,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('保存调试图像失败:', chrome.runtime.lastError);
      } else if (DEBUG_SETTINGS.logToConsole) {
        console.log(`调试图像已保存: debug/${fullFilename}.png`);
      }
    });
  } else {
    // 对于其他类型，转换为文本
    const textContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    // 保存文件
    chrome.downloads.download({
      url: url,
      filename: `debug/${fullFilename}.txt`,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      // 清理URL
      URL.revokeObjectURL(url);
      
      if (chrome.runtime.lastError) {
        console.error('保存调试文本失败:', chrome.runtime.lastError);
      } else if (DEBUG_SETTINGS.logToConsole) {
        console.log(`调试文本已保存: debug/${fullFilename}.txt`);
      }
    });
  }
  
  // 如果设置了显示调试通知，则显示
  if (DEBUG_SETTINGS.showDebugNotifications) {
    showNotification('调试信息已保存', `类型: ${type}, 文件名: ${fullFilename}`);
  }
}

// 长截图函数
function captureFullPage(tab, options) {
  const {
    directory,
    capturedImages,
    currentScrollPosition,
    pageInfo,
    scrollAttempts,
    MAX_SCROLL_ATTEMPTS
  } = options;

  if (!tab || !tab.id) {
    console.error('无效的标签页参数:', tab);
    showNotification('截图失败', '无效的标签页参数');
    return;
  }

  console.log('开始长截图过程，标签页ID:', tab.id);
  
  // 重置状态
  captureInProgress = false;
  lastCaptureTime = 0;
  captureRetryCount = 0;
  
  // 显示开始通知
  showNotification('准备截图', '正在准备开始截图，请稍候...');

  // 向页面注入内容脚本
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: () => {
      // 获取页面信息
      const pageHeight = Math.max(
        document.body.scrollHeight, document.documentElement.scrollHeight,
        document.body.offsetHeight, document.documentElement.offsetHeight,
        document.body.clientHeight, document.documentElement.clientHeight
      );
      
      const pageWidth = Math.max(
        document.body.scrollWidth, document.documentElement.scrollWidth,
        document.body.offsetWidth, document.documentElement.offsetWidth,
        document.body.clientWidth, document.documentElement.clientWidth
      );
      
      // 计算实际内容区域
      function getContentBounds() {
        const allElements = document.getElementsByTagName('*');
        let minX = pageWidth;
        let maxX = 0;
        
        for (const element of allElements) {
          const rect = element.getBoundingClientRect();
          // 忽略不可见元素
          if (element.offsetParent === null || 
              window.getComputedStyle(element).visibility === 'hidden' ||
              (rect.width === 0 && rect.height === 0)) {
            continue;
          }
          
          const absoluteLeft = rect.left + window.scrollX;
          const absoluteRight = rect.right + window.scrollX;
          
          if (absoluteLeft < minX) minX = absoluteLeft;
          if (absoluteRight > maxX) maxX = absoluteRight;
        }
        
        // 添加一些边距
        minX = Math.max(0, minX - 20);
        maxX = Math.min(pageWidth, maxX + 20);
        
        return {
          left: minX,
          right: maxX,
          width: maxX - minX
        };
      }
      
      const contentBounds = getContentBounds();
      
      const windowHeight = window.innerHeight;
      const windowWidth = window.innerWidth;
      
      // 保存原始滚动位置
      const originalScrollTop = window.scrollY || document.documentElement.scrollTop;
      const originalScrollLeft = window.scrollX || document.documentElement.scrollLeft;
      
      // 检查页面是否可滚动
      const isScrollable = pageHeight > windowHeight;
      
      // 尝试隐藏固定元素
      const fixedElements = document.querySelectorAll('*');
      for (let el of fixedElements) {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'sticky') {
          el.dataset.originalDisplay = style.display;
          el.dataset.originalPosition = style.position;
          el.style.display = 'none';
        }
      }
      
      // 隐藏微信二维码元素
      const qrCodeElements = document.querySelectorAll('.qr_code_pc_inner, .qr_code_pc');
      qrCodeElements.forEach(el => {
        el.dataset.originalDisplay = el.style.display;
        el.style.display = 'none';
      });
      
      // 先滚动到页面顶部
      window.scrollTo(0, 0);
      
      return {
        pageHeight,
        pageWidth,
        windowHeight,
        windowWidth,
        originalScrollTop,
        originalScrollLeft,
        isScrollable,
        contentBounds
      };
    }
  }).then((results) => {
    // 获取页面信息
    if (!results || !results[0] || !results[0].result) {
      handleCaptureError(tab, '无法获取页面信息');
      return;
    }
    
    pageInfo = results[0].result;
    console.log('获取页面信息成功:', pageInfo);
    
    // 如果页面不可滚动，直接截取一次
    if (!pageInfo.isScrollable) {
      console.log('页面不可滚动，直接截取整个可见区域');
      captureVisibleTabWithRetry(tab.windowId, 0, true);
      return;
    }
    
    // 显示通知
    showNotification('开始截图', '长截图过程已开始，请勿切换标签页');
    
    // 开始截图过程
    captureNextSection(tab, options);
  }).catch((error) => {
    handleCaptureError(tab, '注入脚本失败: ' + error.message);
  });
}

// 截图下一个区域的函数
function captureNextSection(tab, options) {
  const {
    directory,
    capturedImages,
    currentScrollPosition,
    pageInfo,
    scrollAttempts,
    MAX_SCROLL_ATTEMPTS
  } = options;

  // 检查是否已经截完整个页面
  const nextScrollPosition = currentScrollPosition + Math.floor(pageInfo.windowHeight * 0.8);
  if (nextScrollPosition >= pageInfo.pageHeight) {
    // 如果下一个位置会超过页面高度，直接截取到底部
    if (currentScrollPosition < pageInfo.pageHeight - pageInfo.windowHeight) {
      // 调整最后一次滚动位置，确保刚好覆盖到底部
      currentScrollPosition = pageInfo.pageHeight - pageInfo.windowHeight;
      // 执行最后一次截图
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: (scrollPosition) => {
          window.scrollTo(0, scrollPosition);
          return { 
            currentScroll: window.scrollY || document.documentElement.scrollTop,
            success: true
          };
        },
        args: [currentScrollPosition]
      }).then((scrollResults) => {
        if (!scrollResults || !scrollResults[0] || !scrollResults[0].result || !scrollResults[0].result.success) {
          handleCaptureError(tab, '最后一次滚动失败');
          return;
        }
        // 延迟执行最后一次截图
        setTimeout(() => {
          captureVisibleTabWithRetry(tab.windowId, 0, options);
        }, 500);
      });
    } else {
      // 已经到达底部，直接完成截图
      console.log('已到达页面底部，开始合并图片');
      finishCapture(tab, options);
    }
    return;
  }
  
  // 滚动到指定位置
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: (scrollPosition) => {
      window.scrollTo(0, scrollPosition);
      return { 
        currentScroll: window.scrollY || document.documentElement.scrollTop,
        success: true
      };
    },
    args: [currentScrollPosition]
  }).then((scrollResults) => {
    // 检查滚动是否成功
    if (!scrollResults || !scrollResults[0] || !scrollResults[0].result || !scrollResults[0].result.success) {
      // 如果滚动失败，重试几次
      options.scrollAttempts++;
      if (options.scrollAttempts < options.MAX_SCROLL_ATTEMPTS) {
        console.warn(`滚动失败，重试 (${options.scrollAttempts}/${options.MAX_SCROLL_ATTEMPTS})`);
        setTimeout(() => captureNextSection(tab, options), 500);
      } else {
        handleCaptureError(tab, '无法滚动页面');
      }
      return;
    }
    
    // 重置滚动尝试计数
    options.scrollAttempts = 0;
    
    // 计算需要等待的时间，确保不会触发配额限制
    const now = Date.now();
    const timeElapsed = now - lastCaptureTime;
    const delayNeeded = Math.max(0, MIN_CAPTURE_INTERVAL - timeElapsed);
    
    console.log(`距离上次截图已经过去 ${timeElapsed}ms，需要额外等待 ${delayNeeded}ms`);
    
    // 增加延迟，确保不会触发配额限制
    setTimeout(() => {
      // 更新最后截图时间
      lastCaptureTime = Date.now();
      
      // 截取当前可见区域
      captureVisibleTabWithRetry(tab.windowId, 0, options);
    }, delayNeeded + 500); // 原有延迟加上需要的额外延迟
  }).catch((error) => {
    handleCaptureError(tab, '滚动执行失败: ' + error.message);
  });
}

// 带重试机制的截图函数
function captureVisibleTabWithRetry(windowId, retryCount, options) {
  const {
    directory,
    capturedImages,
    currentScrollPosition,
    pageInfo,
    isSingleCapture = false
  } = options;

  chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      const error = chrome.runtime.lastError.message;
      console.error(`截图失败 (尝试 ${retryCount + 1}/${MAX_CAPTURE_RETRIES}): ${error}`);
      
      // 检查是否是配额错误
      if (error.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND') && retryCount < MAX_CAPTURE_RETRIES) {
        // 配额错误，增加更长的延迟后重试
        showNotification('截图中...', `正在等待配额限制解除 (${retryCount + 1}/${MAX_CAPTURE_RETRIES})`);
        
        // 增加指数退避延迟
        const backoffDelay = MIN_CAPTURE_INTERVAL * Math.pow(2, retryCount);
        console.log(`配额限制，延迟 ${backoffDelay}ms 后重试`);
        
        setTimeout(() => {
          captureVisibleTabWithRetry(windowId, retryCount + 1, options);
        }, backoffDelay);
        return;
      }
      
      // 其他错误或超过重试次数
      handleCaptureError(tab, '截图失败: ' + error);
      return;
    }
    
    // 成功获取截图后，裁剪到实际内容区域
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // 使用内容区域的宽度
      canvas.width = pageInfo.contentBounds.width;
      canvas.height = img.height;
      
      // 绘制时只绘制内容区域
      ctx.drawImage(img, 
        pageInfo.contentBounds.left, 0, pageInfo.contentBounds.width, img.height,  // 源矩形
        0, 0, canvas.width, canvas.height  // 目标矩形
      );
      
      // 获取裁剪后的图片
      const croppedDataUrl = canvas.toDataURL('image/png');
      
      // 如果开启了中间截图保存，则保存当前截图
      if (DEBUG_MODE && DEBUG_SETTINGS.saveIntermediateScreenshots) {
        // 保存中间截图用于调试
        saveIntermediateScreenshot(croppedDataUrl, currentScrollPosition, directory);
      }
      
      // 添加到截图列表
      capturedImages.push({
        dataUrl: croppedDataUrl,
        position: currentScrollPosition
      });
      
      console.log(`成功截取位置${currentScrollPosition}的图片，当前已有${capturedImages.length}张`);
      
      // 如果是单次截图，直接完成
      if (isSingleCapture) {
        console.log('单次截图完成，准备保存');
        finishCapture(tab, options);
        return;
      }
      
      // 更新滚动位置，准备下一次截图
      options.currentScrollPosition += Math.floor(pageInfo.windowHeight * 0.8);
      
      // 继续截取下一部分，使用较长的延迟
      setTimeout(() => {
        captureNextSection(tab, options);
      }, MIN_CAPTURE_INTERVAL);
    };
    
    img.src = dataUrl;
  });
}

// 完成截图过程
function finishCapture(tab, options) {
  const { capturedImages, pageInfo, directory } = options;
  
  console.log('截图完成，准备合并，共有图片:', capturedImages.length);
  
  // 确保有截图
  if (capturedImages.length === 0) {
    handleCaptureError(tab, '未能捕获任何图片');
    return;
  }
  
  // 按位置排序图片
  capturedImages.sort((a, b) => a.position - b.position);
  
  // 提取dataUrl数组
  const imageDataUrls = capturedImages.map(img => img.dataUrl);
  
  // 显示合并进度通知
  showNotification('处理中', `正在合并${capturedImages.length}张截图...`);
  
  // 使用简单画布合并方法
  simpleCanvasMerge(imageDataUrls, pageInfo, directory, (result) => {
    if (result.success) {
      console.log('图片合并成功，保存到:', result.path);
      
      // 检查文件是否存在并显示详细通知
      checkFileAndNotify(result.path, tab);
    } else {
      handleCaptureError(tab, `图片合并失败: ${result.error}`);
    }
  });
}

// 新增：检查文件并显示通知
function checkFileAndNotify(filePath, tab) {
  // 从路径中提取文件名
  const filename = filePath.split('\\').pop();
  const directory = filePath.substring(0, filePath.length - filename.length - 1);
  
  if (DEBUG_MODE && DEBUG_SETTINGS.logToConsole) {
    console.log('最终文件信息:');
    console.log('- 文件名:', filename);
    console.log('- 目录:', directory);
    console.log('- 完整路径:', filePath);
  }
  
  // 保存最终文件信息到调试日志
  if (DEBUG_MODE) {
    getDebugDirectory((debugDir) => {
      saveDebugData({
        action: 'final_merge_complete',
        filename: filename,
        directory: directory,
        fullPath: filePath,
        timestamp: new Date().toISOString(),
        totalImages: capturedImages ? capturedImages.length : 0
      }, 'final_merge_info', 'json', debugDir);
    });
  }
  
  // 使用downloads API检查最近的下载
  chrome.downloads.search({
    limit: 5,
    orderBy: ['-startTime']
  }, (results) => {
    let fileFound = false;
    let fileSize = '未知';
    let downloadItem = null;
    
    // 尝试在最近下载中找到我们的文件
    for (const download of results) {
      if (download.filename.includes(filename)) {
        fileFound = true;
        fileSize = formatFileSize(download.fileSize);
        downloadItem = download;
        break;
      }
    }
    
    if (fileFound && downloadItem) {
      // 文件存在，显示成功通知，包含更多调试信息
      const message = `长截图已保存成功!
文件大小: ${fileSize}
位置: ${filePath}
状态: ${downloadItem.state}
耗时: ${formatElapsedTime(downloadItem.endTime - downloadItem.startTime)}`;
      
      showNotification('截图完成 ✅', message);
      
      // 如果开启了调试，保存详细下载信息
      if (DEBUG_MODE) {
        getDebugDirectory((debugDir) => {
          saveDebugData({
            action: 'download_complete',
            downloadItem: {
              id: downloadItem.id,
              filename: downloadItem.filename,
              fileSize: downloadItem.fileSize,
              state: downloadItem.state,
              startTime: downloadItem.startTime,
              endTime: downloadItem.endTime,
              error: downloadItem.error
            }
          }, 'download_details', 'json', debugDir);
        });
      }
      
      // 显示打开文件夹选项
      showFileLocationNotification(directory);
    } else {
      // 尝试使用downloadItem获取更多信息
      chrome.downloads.search({
        filenameRegex: filename.replace(/\./g, '\\.'),
        exists: true,
        limit: 1
      }, (items) => {
        if (items && items.length > 0) {
          const item = items[0];
          
          // 添加调试信息
          if (DEBUG_MODE && DEBUG_SETTINGS.logToConsole) {
            console.log('下载项详情:', item);
          }
          
          showNotification(
            '截图完成 ✅', 
            `长截图已保存!
文件: ${filename}
大小: ${formatFileSize(item.fileSize)}
位置: ${directory}
文件ID: ${item.id}`
          );
          
          showFileLocationNotification(directory);
        } else {
          // 我们无法确认文件是否存在，显示中性通知
          showNotification(
            '截图处理完成',
            `已尝试保存长截图到:
${filePath}
请检查该位置确认文件是否存在。
更多调试信息请查看控制台。`
          );
          
          showFileLocationNotification(directory);
        }
      });
    }
    
    // 恢复页面状态
    restorePageState(tab);
  });
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return '未知';
  
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// 显示文件位置通知并提供打开选项
function showFileLocationNotification(directory) {
  // 创建可点击的通知以打开文件夹
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'images/icon128.png',  // 确保路径正确
    title: '打开文件位置',
    message: `点击按钮打开保存文件夹:\n${directory}`,
    buttons: [
      { title: '打开文件夹' }
    ],
    requireInteraction: true
  }, (notificationId) => {
    // 存储通知ID与目录的映射关系
    chrome.storage.local.set({
      ['notification_dir_' + notificationId]: directory
    });
  });
}

// 添加全局的通知监听器（只需注册一次）
if (!window.notificationListenerRegistered) {
  // 监听通知点击事件
  chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    if (buttonIndex === 0) {
      // 获取与此通知关联的目录
      chrome.storage.local.get(['notification_dir_' + notificationId], (result) => {
        const dir = result['notification_dir_' + notificationId];
        if (dir) {
          // 打开目录 - 使用系统文件协议
          openDirectory(dir);
          // 清理存储
          chrome.storage.local.remove(['notification_dir_' + notificationId]);
        }
      });
    }
    
    // 关闭通知
    chrome.notifications.clear(notificationId);
  });
  
  // 也处理通知本身的点击
  chrome.notifications.onClicked.addListener((notificationId) => {
    // 获取与此通知关联的目录
    chrome.storage.local.get(['notification_dir_' + notificationId], (result) => {
      const dir = result['notification_dir_' + notificationId];
      if (dir) {
        // 打开目录
        openDirectory(dir);
        // 清理存储
        chrome.storage.local.remove(['notification_dir_' + notificationId]);
      }
      
      // 关闭通知
      chrome.notifications.clear(notificationId);
    });
  });
  
  window.notificationListenerRegistered = true;
}

// 在Windows上打开资源管理器到指定目录
function openDirectory(directory) {
  // 使用chrome.tabs.create打开文件协议URL
  const normalizedPath = directory.replace(/\\/g, '/');
  const fileUrl = `file:///${normalizedPath}`;
  
  console.log(`尝试打开目录: ${fileUrl}`);
  
  chrome.tabs.create({ url: fileUrl }, (tab) => {
    if (chrome.runtime.lastError) {
      console.error('打开目录失败:', chrome.runtime.lastError);
      // 回退方法：显示带有路径的通知，让用户手动打开
      showManualOpenDirectoryNotification(directory);
    }
  });
}

// 显示手动打开目录的通知
function showManualOpenDirectoryNotification(directory) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'images/icon128.png',
    title: '请手动打开目录',
    message: `请复制此路径并在资源管理器中打开:\n${directory}`,
    requireInteraction: true
  });
}

// 错误处理函数
function handleCaptureError(tab, errorMessage) {
  console.error('截图过程错误:', errorMessage);
  
  // 显示错误通知
  showNotification('截图失败', errorMessage);
  
  // 恢复页面状态
  restorePageState(tab);
}

// 恢复页面状态
function restorePageState(tab) {
  // 恢复页面的原始状态
  if (pageInfo && pageInfo.originalScrollTop !== undefined) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: (info) => {
        // 恢复固定元素
        const fixedElements = document.querySelectorAll('*[data-original-display]');
        for (let el of fixedElements) {
          if (el.dataset.originalDisplay) {
            el.style.display = el.dataset.originalDisplay;
            delete el.dataset.originalDisplay;
          }
          if (el.dataset.originalPosition) {
            el.style.position = el.dataset.originalPosition;
            delete el.dataset.originalPosition;
          }
        }

        // 恢复二维码元素
        const qrCodeElements = document.querySelectorAll('.qr_code_pc_inner, .qr_code_pc');
        qrCodeElements.forEach(el => {
          if (el.dataset.originalDisplay) {
            el.style.display = el.dataset.originalDisplay;
            delete el.dataset.originalDisplay;
          }
        });
        
        // 恢复原始滚动位置
        window.scrollTo(info.originalScrollLeft, info.originalScrollTop);
        
        return true;
      },
      args: [pageInfo]
    }).catch(error => {
      console.error('恢复页面状态失败:', error);
    });
  }
  
  // 重置状态标志
  captureInProgress = false;
}

// 辅助函数：加载图片
async function loadImage(dataUrl) {
    try {
        // 从data URL中提取base64数据
        const base64Data = dataUrl.split(',')[1];
        // 转换为二进制数据
        const binaryData = atob(base64Data);
        // 创建 Uint8Array
        const uint8Array = new Uint8Array(binaryData.length);
        for (let i = 0; i < binaryData.length; i++) {
            uint8Array[i] = binaryData.charCodeAt(i);
        }
        // 创建 Blob
        const blob = new Blob([uint8Array], { type: 'image/png' });
        
        // 使用 createImageBitmap 替代 Image
        const imageBitmap = await createImageBitmap(blob);
        console.log('图片加载成功:', imageBitmap.width, 'x', imageBitmap.height);
        return imageBitmap;
    } catch (error) {
        console.error('加载图片失败:', error);
        throw error;
    }
}

// 简单的画布合并函数
async function simpleCanvasMerge(images, pageInfo, directory, callback) {
    console.log('开始合并图片，总数:', images.length);
    
    if (!images || images.length === 0) {
        callback({ success: false, error: '没有可用的图片' });
        return;
    }

    try {
        // 加载第一张图片以获取尺寸
        const firstImage = await loadImage(images[0]);
        console.log('首张图片尺寸:', firstImage.width, 'x', firstImage.height);

        // 计算总高度（考虑20%重叠）
        const overlap = 0.2;
        const effectiveHeight = Math.floor(firstImage.height * (1 - overlap));
        const totalHeight = effectiveHeight * (images.length - 1) + firstImage.height;

        // 使用 OffscreenCanvas 创建画布
        let canvas, tempCanvas;
        let ctx, tempCtx;
        
        try {
            // 使用内容区域的宽度创建画布
            canvas = new OffscreenCanvas(pageInfo.contentBounds.width, totalHeight);
            tempCanvas = new OffscreenCanvas(pageInfo.contentBounds.width, firstImage.height);
            
            ctx = canvas.getContext('2d', {
                alpha: false,
                willReadFrequently: true
            });
            
            tempCtx = tempCanvas.getContext('2d', {
                alpha: false,
                willReadFrequently: true
            });
            
            if (!ctx || !tempCtx) {
                throw new Error('无法获取2D上下文');
            }
        } catch (error) {
            console.error('创建OffscreenCanvas失败:', error);
            callback({ 
                success: false, 
                error: '创建画布失败: ' + error.message 
            });
            return;
        }

        // 使用白色背景
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 计算像素相似度的函数
        function calculatePixelSimilarity(data1, data2) {
            let diff = 0;
            for (let i = 0; i < data1.length; i += 4) {
                diff += Math.abs(data1[i] - data2[i]); // R
                diff += Math.abs(data1[i + 1] - data2[i + 1]); // G
                diff += Math.abs(data1[i + 2] - data2[i + 2]); // B
            }
            return 1 - (diff / (data1.length * 255));
        }

        // 寻找最佳匹配位置的函数
        function findBestMatchPosition(img1, img2, searchRange) {
            let bestScore = -1;
            let bestOffset = 0;
            
            const overlapHeight = Math.floor(img1.height * overlap);
            const basePosition = Math.floor(overlapHeight * 0.5);
            const searchStart = Math.max(0, basePosition - searchRange);
            const searchEnd = Math.min(overlapHeight, basePosition + searchRange);
            
            // 在临时画布上绘制第一张图片的底部区域
            tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
            tempCtx.drawImage(img1, 
                0, img1.height - overlapHeight, 
                img1.width, overlapHeight,
                0, 0,
                img1.width, overlapHeight);
            const img1Data = tempCtx.getImageData(0, 0, img1.width, overlapHeight).data;
            
            for (let offset = searchStart; offset <= searchEnd; offset++) {
                // 在临时画布上绘制第二张图片的顶部区域
                tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
                tempCtx.drawImage(img2,
                    0, offset,
                    img2.width, overlapHeight,
                    0, 0,
                    img2.width, overlapHeight);
                const img2Data = tempCtx.getImageData(0, 0, img2.width, overlapHeight).data;
                
                const similarity = calculatePixelSimilarity(img1Data, img2Data);
                if (similarity > bestScore) {
                    bestScore = similarity;
                    bestOffset = offset;
                }
            }
            
            console.log(`最佳匹配位置: ${bestOffset}, 相似度: ${bestScore.toFixed(4)}`);
            return { offset: bestOffset, similarity: bestScore };
        }

        // 逐个加载和绘制图片
        let currentY = 0;
        let previousImage = null;
        
        for (let i = 0; i < images.length; i++) {
            try {
                console.log(`处理第 ${i + 1}/${images.length} 张图片`);
                const img = await loadImage(images[i]);
                
                // 计算绘制参数
                let sourceY = 0;
                let sourceHeight = img.height;
                let targetY = currentY;
                
                // 如果不是第一张图片，寻找最佳匹配位置
                if (i > 0 && previousImage) {
                    const searchRange = Math.floor(img.height * 0.1); // 搜索范围为图片高度的10%
                    const { offset, similarity } = findBestMatchPosition(previousImage, img, searchRange);
                    
                    // 根据相似度调整重叠区域
                    const overlapHeight = Math.floor(img.height * overlap);
                    
                    // 特殊处理最后一张图片
                    if (i === images.length - 1) {
                        // 对于最后一张图片，我们只保留未重叠的部分和一半的重叠区域
                        sourceY = offset + Math.floor(overlapHeight * 0.5);
                        sourceHeight = img.height - sourceY;
                        targetY = currentY - Math.floor(overlapHeight * 0.5);
                    } else {
                        // 对于中间的图片，使用标准重叠逻辑
                        sourceY = offset;
                        sourceHeight = img.height - sourceY;
                        targetY = currentY - (overlapHeight - offset);
                    }
                    
                    // 添加渐变过渡效果
                    if (i === images.length - 1) {
                        // 最后一张图片使用更短的渐变区域
                        const gradientHeight = Math.floor(overlapHeight * 0.3);
                        const gradient = ctx.createLinearGradient(0, targetY, 0, targetY + gradientHeight);
                        gradient.addColorStop(0, 'rgba(255,255,255,0)');
                        gradient.addColorStop(1, 'rgba(255,255,255,1)');
                        ctx.fillStyle = gradient;
                        ctx.fillRect(0, targetY, canvas.width, gradientHeight);
                    } else {
                        const gradientHeight = Math.floor(overlapHeight * 0.5);
                        const gradient = ctx.createLinearGradient(0, targetY, 0, targetY + gradientHeight);
                        gradient.addColorStop(0, 'rgba(255,255,255,0)');
                        gradient.addColorStop(1, 'rgba(255,255,255,1)');
                        ctx.fillStyle = gradient;
                        ctx.fillRect(0, targetY, canvas.width, gradientHeight);
                    }
                }

                // 绘制图片
                ctx.drawImage(img, 
                    0, sourceY, img.width, sourceHeight,  // 源矩形
                    0, targetY, img.width, sourceHeight   // 目标矩形
                );
                console.log(`已绘制图片 ${i + 1} 到位置 ${targetY}, 源高度: ${sourceHeight}, 源Y: ${sourceY}`);

                // 更新下一张图片的位置（考虑重叠）
                if (i < images.length - 1) {
                    currentY += effectiveHeight;
                }
                
                // 保存当前图片用于下一次比较
                previousImage = img;

                // 保存调试信息
                if (DEBUG_MODE) {
                    saveDebugData({
                        action: 'merge_progress',
                        index: i,
                        position: targetY,
                        sourceY: sourceY,
                        sourceHeight: sourceHeight,
                        imageSize: {
                            width: img.width,
                            height: img.height
                        }
                    }, `merge_step_${i}`, 'json', directory);
                }
            } catch (error) {
                console.error(`处理图片 ${i + 1} 时出错:`, error);
                // 继续处理下一张图片
            }
        }

        // 转换为Blob并保存
        try {
            console.log('正在导出合并后的图片...');
            
            // 生成文件名
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const jpegFilename = `长截图_${timestamp}.jpg`;

            // 获取图像数据
            const imageData = await canvas.convertToBlob({
                type: 'image/jpeg',
                quality: 0.92
            });

            // 创建一个新的 Response 对象
            const response = new Response(imageData);
            
            // 获取 ReadableStream
            const stream = response.body;
            
            // 创建 StreamReader
            const reader = stream.getReader();
            
            // 读取数据
            const chunks = [];
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            
            // 合并所有数据块
            const allChunks = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
            let position = 0;
            for (const chunk of chunks) {
                allChunks.set(chunk, position);
                position += chunk.length;
            }
            
            // 转换为 base64
            let binary = '';
            for (let i = 0; i < allChunks.length; i++) {
                binary += String.fromCharCode(allChunks[i]);
            }
            const base64 = btoa(binary);
            
            // 创建完整的 data URL
            const dataUrl = `data:image/jpeg;base64,${base64}`;

            // 保存文件
            chrome.downloads.download({
                url: dataUrl,
                filename: jpegFilename,
                saveAs: false,
                conflictAction: 'uniquify'
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error('保存文件失败:', chrome.runtime.lastError);
                    callback({ 
                        success: false, 
                        error: '保存文件失败: ' + chrome.runtime.lastError.message 
                    });
                } else {
                    console.log('文件保存请求已发送');
                    callback({
                        success: true,
                        path: `${directory}\\${jpegFilename}`
                    });
                }
            });
        } catch (exportError) {
            console.error('导出图片失败:', exportError);
            callback({ 
                success: false, 
                error: '导出合并图片失败: ' + exportError.message 
            });
        }
    } catch (error) {
        console.error('合并图片过程出错:', error);
        callback({ 
            success: false, 
            error: '合并图片失败: ' + error.message 
        });
    }
}

// 添加prepareForCapture函数，用于初始化截图前的准备工作
function prepareForCapture() {
  // 重置全局状态
  captureInProgress = false;
  
  // 清除可能存在的上次截图残留
  chrome.storage.local.remove(['capturedImages', 'currentPosition', 'pageInfo'], function() {
    if (chrome.runtime.lastError) {
      console.warn('清除上次截图数据时发生错误:', chrome.runtime.lastError);
    } else {
      console.log('成功清除上次截图数据');
    }
  });
  
  return true;
}

// 在页面中执行的滚动函数
function scrollToPosition(position) {
  try {
    console.log('滚动到位置:', position);
    window.scrollTo(0, position);
    return { success: true, position: position };
  } catch (e) {
    console.error('滚动失败:', e);
    return { success: false, error: e.message };
  }
}

// 改进的图像合并函数，采用更稳定的方法，添加调试输出
function mergeImages(capturedImages, pageInfo, callback) {
  try {
    console.log('开始合并图片，共 ' + capturedImages.length + ' 张截图');
    
    // 获取保存目录用于调试
    getDownloadDirectory(function(directory) {
      // 保存调试信息
      saveDebugData({
        action: 'mergeImages_start',
        imageCount: capturedImages.length,
        pageInfo: pageInfo
      }, 'merge_start', 'json', directory);
      
      if (!capturedImages || capturedImages.length === 0) {
        console.error('没有可用的截图');
        callback(null, '没有可用的截图');
        return;
      }
      
      // 单张图片无需合并
      if (capturedImages.length === 1) {
        console.log('只有一张截图，直接使用，无需合并');
        callback(capturedImages[0].dataUrl);
        return;
      }
      
      // 使用旧版Canvas API，更加兼容
      try {
        // 计算实际需要的尺寸
        let maxHeight = 0;
        for (let i = 0; i < capturedImages.length; i++) {
          const pos = capturedImages[i].position;
          maxHeight = Math.max(maxHeight, pos + pageInfo.windowHeight);
        }
        
        // 控制最大高度，防止Canvas限制
        const canvasMaxHeight = 16000; // 大多数浏览器的Canvas高度限制
        if (maxHeight > canvasMaxHeight) {
          console.warn(`图像太高 (${maxHeight}px)，将被截断至 ${canvasMaxHeight}px`);
          
          // 保存调试信息
          saveDebugData({
            action: 'canvas_height_limit',
            originalHeight: maxHeight,
            limitedHeight: canvasMaxHeight
          }, 'canvas_height_limit', 'json', directory);
          
          maxHeight = canvasMaxHeight;
        }
        
        // 保存画布尺寸调试信息
        saveDebugData({
          action: 'canvas_dimensions',
          width: pageInfo.windowWidth,
          height: maxHeight,
          windowWidth: pageInfo.windowWidth,
          windowHeight: pageInfo.windowHeight
        }, 'canvas_dimensions', 'json', directory);
        
        // 创建适当大小的画布
        const canvas = document.createElement('canvas');
        canvas.width = pageInfo.windowWidth;
        canvas.height = maxHeight;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.error('无法获取画布上下文');
          
          // 保存调试信息
          saveDebugData('无法获取画布上下文', 'no_canvas_context', 'text', directory);
          
          // 使用第一张截图作为结果
          callback(capturedImages[0].dataUrl);
          return;
        }
        
        // 使用白色背景
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 安全地处理所有图像
        processImagesForCanvas(capturedImages, canvas, ctx, pageInfo, directory, callback);
      } catch (canvasError) {
        console.error('Canvas创建失败，使用备用方法:', canvasError);
        
        // 保存调试信息
        saveDebugData({
          action: 'canvas_creation_failed',
          error: canvasError.toString()
        }, 'canvas_creation_error', 'json', directory);
        
        // 备用方法：直接使用第一张截图
        callback(capturedImages[0].dataUrl);
      }
    });
  } catch (mainError) {
    console.error('合并主流程错误:', mainError);
    
    // 获取保存目录用于调试
    getDownloadDirectory(function(directory) {
      // 保存调试信息
      saveDebugData({
        action: 'merge_main_error',
        error: mainError.toString()
      }, 'merge_main_error', 'json', directory);
      
      // 作为最后的手段，返回第一张可用的图片
      if (capturedImages && capturedImages.length > 0) {
        callback(capturedImages[0].dataUrl);
      } else {
        callback(null, '图像处理发生严重错误');
      }
    });
  }
}

// 处理画布上的图像，添加调试数据
function processImagesForCanvas(capturedImages, canvas, ctx, pageInfo, directory, callback) {
  let processedCount = 0;
  let maxY = 0;
  
  // 保存调试信息
  saveDebugData({
    action: 'processImages_start',
    imageCount: capturedImages.length
  }, 'process_images_start', 'json', directory);
  
  // 一次加载一张图
  function loadNextImage(index) {
    if (index >= capturedImages.length) {
      // 所有图像处理完毕
      finishCanvasProcessing();
      return;
    }
    
    const imageInfo = capturedImages[index];
    const img = new Image();
    
    // 保存调试信息
    if (DEBUG_MODE) {
      saveDebugData({
        action: 'loading_image',
        index: index,
        position: imageInfo.position
      }, `load_image_${index}`, 'json', directory);
    }
    
    // 设置5秒超时
    const timeoutId = setTimeout(() => {
      console.warn(`图像 ${index} 加载超时，跳过`);
      
      // 保存调试信息
      saveDebugData({
        action: 'image_load_timeout',
        index: index
      }, `image_timeout_${index}`, 'json', directory);
      
      // 处理下一张
      loadNextImage(index + 1);
    }, 5000);
    
    img.onload = function() {
      clearTimeout(timeoutId);
      
      try {
        // 限制绘制高度，防止越界
        const y = Math.min(imageInfo.position, canvas.height - 1);
        const availableHeight = canvas.height - y;
        
        if (availableHeight > 0) {
          // 计算可绘制的源高度
          const sourceHeight = Math.min(img.height, availableHeight);
          
          // 保存绘制信息用于调试
          if (DEBUG_MODE) {
            saveDebugData({
              action: 'drawing_image',
              index: index,
              position: y,
              sourceHeight: sourceHeight,
              imageHeight: img.height,
              imageWidth: img.width
            }, `draw_image_${index}`, 'json', directory);
          }
          
          // 绘制图像
          ctx.drawImage(img, 0, 0, img.width, sourceHeight, 0, y, img.width, sourceHeight);
          
          // 跟踪画布使用情况
          maxY = Math.max(maxY, y + sourceHeight);
          processedCount++;
        }
        
        // 释放资源
        img.src = '';
      } catch (drawError) {
        console.error(`绘制图像 ${index} 错误:`, drawError);
        
        // 保存调试信息
        saveDebugData({
          action: 'image_draw_error',
          index: index,
          error: drawError.toString()
        }, `draw_error_${index}`, 'json', directory);
      }
      
      // 处理下一张图像
      setTimeout(() => { 
        loadNextImage(index + 1);
      }, 10);
    };
    
    img.onerror = function() {
      clearTimeout(timeoutId);
      console.error(`图像 ${index} 加载失败`);
      
      // 保存调试信息
      saveDebugData({
        action: 'image_load_error',
        index: index
      }, `load_error_${index}`, 'json', directory);
      
      // 处理下一张
      setTimeout(() => { 
        loadNextImage(index + 1);
      }, 10);
    };
    
    try {
      img.src = imageInfo.dataUrl;
    } catch (srcError) {
      clearTimeout(timeoutId);
      console.error(`设置图像 ${index} 源时出错:`, srcError);
      
      // 保存调试信息
      saveDebugData({
        action: 'image_src_error',
        index: index,
        error: srcError.toString()
      }, `src_error_${index}`, 'json', directory);
      
      // 处理下一张
      setTimeout(() => { 
        loadNextImage(index + 1);
      }, 10);
    }
  }
  
  // 开始处理第一张图像
  loadNextImage(0);
  
  // 完成所有图像处理
  function finishCanvasProcessing() {
    try {
      console.log(`已成功处理 ${processedCount}/${capturedImages.length} 张图像`);
      
      // 保存调试信息
      saveDebugData({
        action: 'canvas_processing_complete',
        processedImages: processedCount,
        totalImages: capturedImages.length,
        maxY: maxY,
        canvasHeight: canvas.height
      }, 'canvas_processing_complete', 'json', directory);
      
      if (processedCount === 0) {
        // 没有成功处理任何图像
        console.error('没有图像能够被处理');
        
        // 保存调试信息
        saveDebugData('没有图像能够被处理', 'no_images_processed', 'text', directory);
        
        callback(capturedImages[0].dataUrl);
        return;
      }
      
      // 尝试裁剪Canvas到实际使用的高度
      try {
        if (maxY > 0 && maxY < canvas.height) {
          // 创建一个新的、更小的Canvas
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = canvas.width;
          finalCanvas.height = maxY;
          
          // 保存裁剪信息用于调试
          saveDebugData({
            action: 'canvas_crop',
            originalHeight: canvas.height,
            croppedHeight: maxY,
            width: canvas.width
          }, 'canvas_crop', 'json', directory);
          
          const finalCtx = finalCanvas.getContext('2d');
          if (finalCtx) {
            // 复制内容到较小的画布
            finalCtx.drawImage(canvas, 0, 0);
            
            // 使用较小的画布导出
            try {
              const finalDataUrl = finalCanvas.toDataURL('image/jpeg', 0.9);
              console.log('成功创建合并图像，大小约:', Math.round(finalDataUrl.length/1024), 'KB');
              
              // 保存调试信息
              saveDebugData({
                action: 'final_image_created',
                format: 'jpeg',
                quality: 0.9,
                sizeKB: Math.round(finalDataUrl.length/1024)
              }, 'final_image_info', 'json', directory);
              
              // 保存最终图像的副本用于调试
              if (DEBUG_MODE) {
                saveDebugData(finalDataUrl, 'cropped_final_image', 'image', directory);
              }
              
              callback(finalDataUrl);
              return;
            } catch (exportError) {
              console.error('导出最终图像失败:', exportError);
              
              // 保存调试信息
              saveDebugData({
                action: 'final_export_error',
                error: exportError.toString()
              }, 'final_export_error', 'json', directory);
            }
          }
        }
      } catch (resizeError) {
        console.warn('裁剪画布失败，将使用完整尺寸:', resizeError);
        
        // 保存调试信息
        saveDebugData({
          action: 'canvas_crop_error',
          error: resizeError.toString()
        }, 'canvas_crop_error', 'json', directory);
      }
      
      // 如果裁剪失败，尝试导出完整尺寸
      try {
        // 尝试降低质量导出为JPEG以减小大小
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        console.log('使用完整尺寸创建合并图像，大小约:', Math.round(dataUrl.length/1024), 'KB');
        
        // 保存调试信息
        saveDebugData({
          action: 'full_canvas_export',
          format: 'jpeg',
          quality: 0.85,
          sizeKB: Math.round(dataUrl.length/1024)
        }, 'full_canvas_export', 'json', directory);
        
        // 保存最终图像的副本用于调试
        if (DEBUG_MODE) {
          saveDebugData(dataUrl, 'full_final_image', 'image', directory);
        }
        
        callback(dataUrl);
      } catch (finalError) {
        console.error('导出最终图像失败，使用备用方法:', finalError);
        
        // 保存调试信息
        saveDebugData({
          action: 'final_export_fatal_error',
          error: finalError.toString()
        }, 'final_export_fatal', 'json', directory);
        
        // 使用分块保存方法
        if (capturedImages.length > 0) {
          callback(capturedImages[0].dataUrl, '无法合并全部图像，将使用部分图像');
        } else {
          callback(null, '无法处理任何图像');
        }
      }
    } catch (error) {
      console.error('画布处理完成阶段出错:', error);
      
      // 保存调试信息
      saveDebugData({
        action: 'canvas_completion_error',
        error: error.toString()
      }, 'canvas_completion_error', 'json', directory);
      
      callback(null, '画布处理完成时出错');
    }
  }
}

// 改进保存截图到指定目录的函数
function saveScreenshot(imageUrl, pageTitle, directory) {
  try {
    // 验证图片URL是否有效
    if (!imageUrl || typeof imageUrl !== 'string') {
      console.error('图片URL无效，无法保存', typeof imageUrl);
      showNotification('保存失败', '生成的图片无效，请重试');
      return;
    }
    
    // 获取当前时间作为文件名的一部分
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTitle = (pageTitle || 'screenshot').replace(/[\\/:*?"<>|]/g, '_').substring(0, 50); // 限制标题长度
    const filename = `${safeTitle}_${timestamp}.png`;
    
    console.log('正在保存截图:', filename);
    
    // 处理不同类型的图片URL
    if (imageUrl.startsWith('data:image/')) {
      // 对于data URL，使用更可靠的分块处理方法
      console.log('检测到data URL，使用分块处理方法');
      
      try {
        // 尝试直接从data URL保存
        saveDataUrlAsImage(imageUrl, filename, directory);
      } catch (error) {
        console.error('直接保存data URL失败，尝试备用方法:', error);
        // 备用方法1：尝试修剪data URL
        saveDataUrlWithFallback(imageUrl, filename, directory);
      }
    } else if (imageUrl.startsWith('blob:')) {
      // 对于blob URL，直接下载
      console.log('检测到blob URL，直接下载');
      chrome.downloads.download({
        url: imageUrl,
        filename: filename,
        saveAs: false,
        conflictAction: 'uniquify'
      }, function(downloadId) {
        if (chrome.runtime.lastError) {
          console.error('保存错误:', chrome.runtime.lastError);
          showNotification('保存失败', `无法保存截图: ${chrome.runtime.lastError.message}`);
        } else {
          showNotification('截图完成', `长截图已保存到 ${directory} 目录`);
        }
        
        // 释放URL对象
        URL.revokeObjectURL(imageUrl);
      });
    } else {
      // 未知类型的URL，尝试直接下载
      console.warn('未知类型的URL，尝试直接下载:', imageUrl.substring(0, 50) + '...');
      chrome.downloads.download({
        url: imageUrl,
        filename: filename,
        saveAs: false,
        conflictAction: 'uniquify'
      }, function(downloadId) {
        if (chrome.runtime.lastError) {
          console.error('保存错误:', chrome.runtime.lastError);
          showNotification('保存失败', `无法保存截图: ${chrome.runtime.lastError.message}`);
        } else {
          showNotification('截图完成', `长截图已保存到 ${directory} 目录`);
        }
      });
    }
  } catch (error) {
    console.error('保存截图错误:', error);
    showNotification('保存失败', `保存截图出错: ${error.message}`);
  }
}

// 直接保存data URL为图片
function saveDataUrlAsImage(dataUrl, filename, directory) {
  if (!dataUrl || !filename || !directory) {
    console.error('保存图片参数无效:', { dataUrl: !!dataUrl, filename, directory });
    return { success: false, error: '保存参数无效' };
  }
  
  console.log(`保存图片: ${filename} 到 ${directory}`);
  
  try {
    // 尝试使用chrome.downloads保存
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false,
      conflictAction: 'uniquify',
      headers: [
        {name: 'Content-Type', value: 'image/jpeg'}
      ]
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('下载失败:', chrome.runtime.lastError);
        // 失败时尝试回退方法
        saveDataUrlWithFallback(dataUrl, filename, directory);
        return;
      }
      
      // 监听下载完成事件
      chrome.downloads.onChanged.addListener(function downloadListener(delta) {
        if (delta.id === downloadId && delta.state) {
          if (delta.state.current === 'complete') {
            console.log('下载完成:', filename);
            // 移除监听器
            chrome.downloads.onChanged.removeListener(downloadListener);
            
            // 获取下载项以确认文件位置
            chrome.downloads.search({id: downloadId}, (items) => {
              if (items && items.length > 0) {
                console.log('确认文件已保存:', items[0].filename);
              }
            });
          } else if (delta.state.current === 'interrupted') {
            console.error('下载中断:', delta.error && delta.error.current);
            // 移除监听器
            chrome.downloads.onChanged.removeListener(downloadListener);
            // 尝试回退方法
            saveDataUrlWithFallback(dataUrl, filename, directory);
          }
        }
      });
    });
    
    return { success: true };
  } catch (error) {
    console.error('保存图片错误:', error);
    // 出错时尝试回退方法
    saveDataUrlWithFallback(dataUrl, filename, directory);
    return { success: false, error: error.message };
  }
}

// 备用保存方法 - 使用分块下载，处理大文件
function saveDataUrlWithFallback(dataUrl, filename, directory) {
  console.log('使用备用方法保存 ', filename);
  
  // 尝试使用HTML5的a标签下载方法
  try {
    // 创建下载链接
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    
    // 追加到DOM并触发点击
    document.body.appendChild(a);
    a.click();
    
    // 清理DOM
    setTimeout(function() {
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }, 100);
    
    console.log('使用a标签方法保存完成');
    
    // 提示用户确认保存位置
    showManualSaveConfirmation(filename, directory);
    
    return true;
  } catch (e) {
    console.error('使用a标签方法保存失败:', e);
    
    // 最后尝试分块保存方法
    try {
      saveCanvasInChunks(dataUrl, filename, directory);
      return true;
    } catch (chunkError) {
      console.error('分块保存方法也失败:', chunkError);
      
      // 显示手动保存通知
      showManualSaveNotification(directory, dataUrl, filename);
      return false;
    }
  }
}

// 显示手动保存确认对话框
function showManualSaveConfirmation(filename, directory) {
  // 创建通知，要求用户确认文件是否已保存
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'images/icon128.png',
    title: '请确认文件已保存',
    message: `Chrome可能已询问您保存文件的位置。\n\n文件名: ${filename}\n建议保存到: ${directory}\n\n请检查文件是否已成功保存。`,
    buttons: [
      { title: '已成功保存' },
      { title: '保存失败' }
    ],
    requireInteraction: true
  }, (notificationId) => {
    // 存储通知相关信息
    chrome.storage.local.set({
      ['save_confirmation_' + notificationId]: {
        filename: filename,
        directory: directory
      }
    });
  });
  
  // 处理确认结果
  if (!window.saveConfirmationListenerRegistered) {
    chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
      // 检查是否是我们的确认通知
      chrome.storage.local.get(['save_confirmation_' + notificationId], (result) => {
        const data = result['save_confirmation_' + notificationId];
        if (!data) return;
        
        if (buttonIndex === 0) {
          // 用户确认已保存成功
          console.log('用户确认文件已成功保存');
          showNotification('保存确认', '感谢确认！文件已成功保存。');
        } else {
          // 用户报告保存失败
          console.log('用户报告文件保存失败');
          // 显示备用保存方式
          showManualSaveNotification(data.directory);
        }
        
        // 清理存储
        chrome.storage.local.remove(['save_confirmation_' + notificationId]);
        chrome.notifications.clear(notificationId);
      });
    });
    
    window.saveConfirmationListenerRegistered = true;
  }
}

// 提供手动保存的通知
function showManualSaveNotification(directory, dataUrl, filename) {
  let message = `自动保存失败，请按照以下步骤手动保存：
  
1. 右键点击此通知，选择"检查元素"
2. 在控制台中输入 saveBase64AsFile()
3. 将出现的对话框中选择保存位置: ${directory}`;

  if (dataUrl && filename) {
    // 将数据保存在临时全局变量中，便于用户手动触发保存
    window.pendingSaveData = {
      dataUrl: dataUrl,
      filename: filename,
      directory: directory
    };
    
    // 添加函数供用户从控制台调用
    window.saveBase64AsFile = function() {
      if (window.pendingSaveData) {
        const a = document.createElement('a');
        a.href = window.pendingSaveData.dataUrl;
        a.download = window.pendingSaveData.filename;
        a.click();
        
        // 清理全局变量
        setTimeout(() => {
          window.pendingSaveData = null;
        }, 5000);
        
        return "正在保存文件，请选择保存位置...";
      } else {
        return "没有待保存的数据";
      }
    };
    
    message = `自动保存失败，请按照以下步骤手动保存：
    
1. 请打开开发者控制台 (F12或右键检查)
2. 在控制台中输入: saveBase64AsFile()
3. 在弹出的保存对话框中选择位置: ${directory}
4. 文件名设为: ${filename}`;
  }
  
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'images/icon128.png',
    title: '需要手动保存文件',
    message: message,
    requireInteraction: true
  });
}

// 使用Canvas分块处理大图像
function saveCanvasInChunks(dataUrl, filename, directory) {
  try {
    console.log('尝试Canvas分块处理');
    
    // 创建一个图像
    const img = new Image();
    img.onload = function() {
      try {
        const imgWidth = img.width;
        const imgHeight = img.height;
        
        // 如果图像太大，分割成多个部分
        if (imgHeight > 8000) {
          console.log('图像过大，分割保存');
          
          // 分割为多个小图像
          const chunkHeight = 4000; // 每部分高度
          const numChunks = Math.ceil(imgHeight / chunkHeight);
          
          for (let i = 0; i < numChunks; i++) {
            const startY = i * chunkHeight;
            const height = Math.min(chunkHeight, imgHeight - startY);
            
            // 创建Canvas
            const canvas = document.createElement('canvas');
            canvas.width = imgWidth;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              console.error('无法获取Canvas上下文');
              continue;
            }
            
            // 绘制部分图像
            ctx.drawImage(img, 0, startY, imgWidth, height, 0, 0, imgWidth, height);
            
            // 导出为图像
            try {
              const chunkDataUrl = canvas.toDataURL('image/jpeg', 0.8);
              const chunkFilename = `${filename.replace('.png', '')}_part${i+1}.jpg`;
              
              // 保存这部分
              chrome.downloads.download({
                url: chunkDataUrl,
                filename: chunkFilename,
                saveAs: false,
                conflictAction: 'uniquify'
              });
              
              // 为第一部分显示通知
              if (i === 0) {
                showNotification('截图太大，已分割保存', 
                  `截图已分为${numChunks}部分保存到 ${directory} 目录`);
              }
            } catch (err) {
              console.error(`保存第${i+1}部分失败:`, err);
            }
          }
        } else {
          // 图像不太大，尝试直接保存为JPEG
          const canvas = document.createElement('canvas');
          canvas.width = imgWidth;
          canvas.height = imgHeight;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('无法获取Canvas上下文');
          }
          
          ctx.drawImage(img, 0, 0);
          
          const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.8);
          const jpegFilename = filename.replace('.png', '.jpg');
          
          chrome.downloads.download({
            url: jpegDataUrl,
            filename: jpegFilename,
            saveAs: false,
            conflictAction: 'uniquify'
          }, function(downloadId) {
            if (chrome.runtime.lastError) {
              console.error('保存JPEG格式失败:', chrome.runtime.lastError);
              showManualSaveNotification(directory);
            } else {
              showNotification('截图完成', `长截图已保存到 ${directory} 目录`);
            }
          });
        }
      } catch (error) {
        console.error('分块处理失败:', error);
        showManualSaveNotification(directory);
      }
    };
    
    img.onerror = function() {
      console.error('加载图像失败');
      showManualSaveNotification(directory);
    };
    
    img.src = dataUrl;
  } catch (error) {
    console.error('Canvas分块处理出错:', error);
    showManualSaveNotification(directory);
  }
}

// 创建调试信息文件夹
function createDebugDirectory(baseDirectory, callback) {
  // 创建调试子目录 - 使用时间戳命名
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const debugDir = `${baseDirectory}\\debug_${timestamp}`;
  
  // 直接假设目录已存在或可以创建
  if (DEBUG_SETTINGS.logToConsole) {
    console.log(`调试目录: ${debugDir}`);
  }
  
  // 保存调试目录到存储中
  chrome.storage.local.set({ 'current_debug_directory': debugDir }, () => {
    if (DEBUG_SETTINGS.showDebugNotifications) {
      showNotification('调试模式', `调试信息将保存到: ${debugDir}`);
    }
    callback(debugDir);
  });
}

// 获取当前调试目录
function getDebugDirectory(callback) {
  chrome.storage.local.get('current_debug_directory', (result) => {
    if (result && result.current_debug_directory) {
      callback(result.current_debug_directory);
    } else {
      // 如果不存在，则创建新的调试目录
      getDownloadDirectory((baseDir) => {
        createDebugDirectory(baseDir, callback);
      });
    }
  });
}

// 保存中间截图
function saveIntermediateScreenshot(dataUrl, position, baseDirectory) {
  // 生成文件名
  const timestamp = Date.now();
  const filename = `中间截图_pos${position}_${timestamp}.png`;
  
  // 获取或创建调试目录
  getDebugDirectory((debugDir) => {
    // 保存截图
    chrome.downloads.download({
      url: dataUrl,
      filename: `debug_screenshots/${filename}`,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('保存中间截图失败:', chrome.runtime.lastError);
      } else if (DEBUG_SETTINGS.logToConsole) {
        console.log(`中间截图已保存: debug_screenshots/${filename}`);
        
        // 记录中间截图信息到调试日志
        saveDebugData({
          action: 'intermediate_screenshot',
          position: position,
          timestamp: timestamp,
          filename: filename,
          path: `debug_screenshots/${filename}`
        }, `intermediate_screenshot_info`, 'json', debugDir);
      }
    });
  });
}