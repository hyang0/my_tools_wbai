import tkinter as tk
from tkinter import ttk, messagebox
import subprocess
import win32com.client

class DNSSwitcherApp:
    def __init__(self, root):
        self.root = root
        self.root.title("DNS切换工具")
        
        # 获取网络适配器列表
        self.adapters = self.get_network_adapters()
        
        # 创建界面组件
        self.create_widgets()
        
        # 初始化当前DNS显示
        self.show_current_dns()

    def get_network_adapters(self):
        """获取所有网络适配器名称"""
        adapters = []
        wmi = win32com.client.GetObject("winmgmts:")
        for adapter in wmi.InstancesOf("Win32_NetworkAdapter"):
            print(adapter.NetConnectionStatus)
            if adapter.NetConnectionStatus:  # 已连接的适配器
                adapters.append(adapter.NetConnectionID)
        return adapters

    def create_widgets(self):
        # 网络适配器选择
        ttk.Label(self.root, text="选择网络适配器:").grid(row=0, column=0, padx=5, pady=5, sticky=tk.W)
        self.adapter_combo = ttk.Combobox(self.root, values=self.adapters)
        self.adapter_combo.grid(row=0, column=1, padx=5, pady=5, sticky=tk.EW)
        if self.adapters:
            self.adapter_combo.current(0)

        # DNS模式选择
        self.dns_mode = tk.StringVar(value="auto")
        ttk.Radiobutton(self.root, text="自动获取DNS", variable=self.dns_mode, 
                      value="auto", command=self.toggle_dns_fields).grid(row=1, column=0, columnspan=2, sticky=tk.W)
        ttk.Radiobutton(self.root, text="手动设置DNS", variable=self.dns_mode, 
                      value="manual", command=self.toggle_dns_fields).grid(row=2, column=0, columnspan=2, sticky=tk.W)

        # DNS输入字段
        ttk.Label(self.root, text="主DNS:").grid(row=3, column=0, padx=5, pady=5, sticky=tk.W)
        self.primary_dns = ttk.Entry(self.root)
        self.primary_dns.grid(row=3, column=1, padx=5, pady=5, sticky=tk.EW)

        ttk.Label(self.root, text="备用DNS:").grid(row=4, column=0, padx=5, pady=5, sticky=tk.W)
        self.secondary_dns = ttk.Entry(self.root)
        self.secondary_dns.grid(row=4, column=1, padx=5, pady=5, sticky=tk.EW)

        # 当前DNS显示
        self.current_dns_label = ttk.Label(self.root, text="")
        self.current_dns_label.grid(row=5, column=0, columnspan=2, padx=5, pady=5)

        # 应用按钮
        ttk.Button(self.root, text="应用配置", command=self.apply_dns).grid(row=6, column=0, columnspan=2, pady=10)

        # 配置网格布局
        self.root.columnconfigure(1, weight=1)

    def toggle_dns_fields(self):
        """切换DNS输入字段状态"""
        state = "normal" if self.dns_mode.get() == "manual" else "disabled"
        self.primary_dns.config(state=state)
        self.secondary_dns.config(state=state)

    def show_current_dns(self):
        """显示当前DNS配置"""
        adapter = self.adapter_combo.get()
        try:
            result = subprocess.check_output(
                f'netsh interface ipv4 show dnsservers "{adapter}"',
                shell=True,
                text=True
            )
            self.current_dns_label.config(text=result)
        except subprocess.CalledProcessError as e:
            messagebox.showerror("错误", f"获取DNS配置失败:\n{e.output}")

    def apply_dns(self):
        """应用DNS配置"""
        adapter = self.adapter_combo.get()
        if not adapter:
            messagebox.showerror("错误", "请选择网络适配器")
            return

        try:
            if self.dns_mode.get() == "auto":
                subprocess.run(
                    f'netsh interface ipv4 set dns name="{adapter}" source=dhcp',
                    shell=True,
                    check=True
                )
            else:
                primary = self.primary_dns.get()
                secondary = self.secondary_dns.get()
                
                if not primary:
                    messagebox.showerror("错误", "请输入主DNS地址")
                    return
                
                # 设置主DNS
                subprocess.run(
                    f'netsh interface ipv4 set dns name="{adapter}" static {primary} primary',
                    shell=True,
                    check=True
                )
                
                # 设置备用DNS
                if secondary:
                    subprocess.run(
                        f'netsh interface ipv4 add dns name="{adapter}" {secondary} index=2',
                        shell=True,
                        check=True
                    )
            
            messagebox.showinfo("成功", "DNS配置已更新")
            self.show_current_dns()
            
        except subprocess.CalledProcessError as e:
            messagebox.showerror("错误", f"配置DNS失败:\n{e.stderr}")
        except Exception as e:
            messagebox.showerror("错误", f"发生未知错误:\n{str(e)}")

if __name__ == "__main__":
    root = tk.Tk()
    app = DNSSwitcherApp(root)
    root.mainloop()
