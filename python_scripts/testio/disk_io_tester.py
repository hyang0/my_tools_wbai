import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import os
import time
import threading

import win32file
import win32con

def read_file_without_cache(file_path):
    try:
        # 以只读模式打开文件，并设置 FILE_FLAG_NO_BUFFERING 标志
        handle = win32file.CreateFile(
            file_path,
            win32con.GENERIC_READ,
            0,
            None,
            win32con.OPEN_EXISTING,
            win32con.FILE_FLAG_NO_BUFFERING,
            0
        )
        block_size = 1024*1024
        total_bytes_read = 0
        while True:
            # 从文件中读取数据
            (error_code, data) = win32file.ReadFile(handle, block_size)
            if len(data) == 0:
                break
            total_bytes_read += len(data)
        #print(f"总共读取了 {total_bytes_read} 字节")
        # 关闭文件句柄
        win32file.CloseHandle(handle)
    except Exception as e:
        print(f"发生错误: {e}")


class DiskIOTester:
    def __init__(self, master):
        self.master = master
        master.title("磁盘IO性能测试工具")
        master.geometry("400x300")
        
        # 初始化控件
        self.create_widgets()
        self.update_drives()
        
    def create_widgets(self):
        # 磁盘选择
        self.drive_frame = ttk.LabelFrame(self.master, text="选择测试磁盘")
        self.drive_frame.pack(pady=10, padx=10, fill="x")
        
        self.drive_combobox = ttk.Combobox(self.drive_frame)
        self.drive_combobox.pack(pady=5, padx=5, fill="x")
        
        # 测试参数
        self.settings_frame = ttk.LabelFrame(self.master, text="测试设置")
        self.settings_frame.pack(pady=10, padx=10, fill="x")
        
        ttk.Label(self.settings_frame, text="测试文件大小 (MB):").grid(row=0, column=0, padx=5)
        self.file_size = ttk.Entry(self.settings_frame)
        self.file_size.insert(0, "100")
        self.file_size.grid(row=0, column=1, padx=5)
        
        # 测试按钮
        self.test_btn = ttk.Button(self.master, text="开始测试", command=self.start_test)
        self.test_btn.pack(pady=10)
        
        # 结果展示
        self.result_frame = ttk.LabelFrame(self.master, text="测试结果")
        self.result_frame.pack(pady=10, padx=10, fill="both", expand=True)
        
        ttk.Label(self.result_frame, text="写入速度:").grid(row=0, column=0, padx=5, sticky="w")
        self.write_speed = ttk.Label(self.result_frame, text="0 MB/s")
        self.write_speed.grid(row=0, column=1, padx=5, sticky="w")
        
        ttk.Label(self.result_frame, text="读取速度:").grid(row=1, column=0, padx=5, sticky="w")
        self.read_speed = ttk.Label(self.result_frame, text="0 MB/s")
        self.read_speed.grid(row=1, column=1, padx=5, sticky="w")
    
    def update_drives(self):
        drives = []
        for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
            if os.path.exists(f"{letter}:"):
                drives.append(f"{letter}:\\")
        self.drive_combobox["values"] = drives
        if drives:
            self.drive_combobox.current(0)
    
    def start_test(self):
        if not self.drive_combobox.get():
            messagebox.showerror("错误", "请先选择测试磁盘")
            return
            
        try:
            file_size_mb = int(self.file_size.get())
            if file_size_mb < 10:
                raise ValueError
        except ValueError:
            messagebox.showerror("错误", "请输入有效的文件大小（至少10MB）")
            return
            
        test_dir = self.drive_combobox.get()
        if not os.path.exists(test_dir):
            messagebox.showerror("错误", "所选磁盘不可用")
            return
            
        self.test_btn["state"] = "disabled"
        threading.Thread(target=self.run_io_test, args=(test_dir, file_size_mb), daemon=True).start()
    
    def run_io_test(self, test_dir, file_size_mb):
        test_file = os.path.join(test_dir, "iotestfile.bin")
        file_size = file_size_mb * 1024 * 1024  # 转换为字节
        
        try:
            # 写入测试
            start_time = time.time()
            with open(test_file, "wb") as f:
                f.write(os.urandom(file_size))
            write_time = time.time() - start_time
            
            # 读取测试
            start_time = time.time()
            # 不从缓存读
            read_file_without_cache(test_file)
            # 默认会从缓存中读，对测速有影响
            # with open(test_file, "rb") as f:
            #     while f.read(1024*1024):  # 每次读取1MB
            #         pass
            read_time = time.time() - start_time
            
            # 删除测试文件
            os.remove(test_file)
            
            # 更新界面
            self.master.after(0, self.update_results, 
                            write_time/file_size_mb, 
                            read_time/file_size_mb)
            
        except Exception as e:
            self.master.after(0, messagebox.showerror, "测试失败", str(e))
        finally:
            if os.path.exists(test_file):
                try:
                    os.remove(test_file)
                except:
                    pass
            self.master.after(0, lambda: self.test_btn.config(state="normal"))
    
    def update_results(self, write_time, read_time):
        write_speed = 1 / write_time if write_time != 0 else 0
        read_speed = 1 / read_time if read_time != 0 else 0
        
        self.write_speed.config(text=f"{write_speed:.2f} MB/s")
        self.read_speed.config(text=f"{read_speed:.2f} MB/s")

if __name__ == "__main__":
    root = tk.Tk()
    app = DiskIOTester(root)
    root.mainloop()
