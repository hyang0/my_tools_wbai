document.getElementById('exportBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  try {
    // 首先注入所有需要的函数
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: injectHelperFunctions,
    });

    // 然后执行数据提取
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: startExtraction,
    });

    if (results && results[0].result) {
      const csvContent = convertToCSV(results[0].result);
      downloadCSV(csvContent);
    }
  } catch (error) {
    console.error('Error:', error);
  }
});

function injectHelperFunctions() {
  // 注入辅助函数到页面上下文
  window.extractTableData = function() {
    const rows = document.querySelectorAll('tr.el-table__row');
    const data = [];

    rows.forEach(row => {
      const rowData = [];
      const cells = row.querySelectorAll('td .cell span[data-v-3303c27c]');
      
      cells.forEach(cell => {
        let text = cell.innerText || cell.textContent;
        if (text && !cell.closest('button')) {
          text = text.trim();
          rowData.push(text);
        }
      });

      if (rowData.length > 0) {
        data.push(rowData);
      }
    });

    return data;
  };

  window.sleep = function(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  };

  window.waitForTableUpdate = async function() {
    await sleep(1000); // 基础等待时间
    
    // 额外检查表格是否在加载中
    const loadingElement = document.querySelector('.el-table__body-wrapper .el-loading-mask');
    if (loadingElement) {
      // 如果表格正在加载，等待加载消失
      while (document.querySelector('.el-table__body-wrapper .el-loading-mask')) {
        await sleep(500);
      }
      // 加载完成后额外等待一小段时间确保数据渲染
      await sleep(500);
    }
  };
}

async function startExtraction() {
  let allData = [];
  
  // 获取总页数
  const lastPageElement = document.querySelector('.el-pager li.number:last-child');
  if (!lastPageElement) return [];
  const totalPages = parseInt(lastPageElement.textContent);
  
  // 存储当前页码
  const currentPage = parseInt(document.querySelector('.el-pager li.active').textContent);
  
  // 创建进度显示
  let progressDiv = document.getElementById('progressInfo');
  if (!progressDiv) {
    progressDiv = document.createElement('div');
    progressDiv.id = 'progressInfo';
    progressDiv.style.position = 'fixed';
    progressDiv.style.top = '10px';
    progressDiv.style.right = '10px';
    progressDiv.style.padding = '10px';
    progressDiv.style.background = 'rgba(0, 0, 0, 0.7)';
    progressDiv.style.color = 'white';
    progressDiv.style.borderRadius = '5px';
    progressDiv.style.zIndex = '9999';
    document.body.appendChild(progressDiv);
  }

  try {
    for (let page = 1; page <= totalPages; page++) {
      progressDiv.textContent = `正在导出: ${page}/${totalPages} 页`;
      
      if (page !== currentPage) {
        // 尝试直接点击页码按钮
        const pageButtons = document.querySelectorAll('.el-pager li.number');
        let targetButton = null;
        
        for (const button of pageButtons) {
          if (parseInt(button.textContent) === page) {
            targetButton = button;
            break;
          }
        }
        
        if (!targetButton) {
          // 使用输入框跳转
          const input = document.querySelector('.el-pagination__jump input');
          if (input) {
            input.value = page;
            // 触发输入事件
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(100);
            // 触发回车键
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
          }
        } else {
          targetButton.click();
        }
        
        // 等待表格更新
        await waitForTableUpdate();
      }
      
      // 获取当前页数据
      const pageData = extractTableData();
      allData = allData.concat(pageData);
    }
  } catch (error) {
    console.error('Extraction error:', error);
  } finally {
    // 清理进度显示
    if (progressDiv) {
      progressDiv.remove();
    }
    
    // 恢复到原始页码
    if (currentPage !== parseInt(document.querySelector('.el-pager li.active').textContent)) {
      const input = document.querySelector('.el-pagination__jump input');
      if (input) {
        input.value = currentPage;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(100);
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      }
    }
  }
  
  return allData;
}

function convertToCSV(data) {
  const headers = ['手机号', '姓名', 'IP地址', 'MAC地址', '登录时间', '在线时长', '上行流量', '下行流量', '终端类型'];
  const csvRows = [headers];

  data.forEach(row => {
    csvRows.push(row);
  });

  return csvRows.map(row => row.join(',')).join('\n');
}

function downloadCSV(csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `table_export_${timestamp}.csv`;

  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  });
} 