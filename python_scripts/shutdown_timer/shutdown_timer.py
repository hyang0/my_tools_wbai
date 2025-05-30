import configparser
import time
import os
import signal
from datetime import datetime, timedelta
import threading
import pystray
from pystray import MenuItem as item
from PIL import Image, ImageDraw
import tkinter as tk
from tkinter import messagebox

CONFIG_FILE = 'config.ini'
exit_event = threading.Event()  # 用于控制线程退出

def signal_handler(signum, frame):
    print("\n正在退出程序...")
    exit_event.set()

# 注册信号处理
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# 自动识别编码读取 ini 文件
def read_config(filename):
    encodings = ['utf-8', 'gb2312']
    for enc in encodings:
        try:
            with open(filename, 'r', encoding=enc) as f:
                cp = configparser.ConfigParser()
                cp.read_file(f)
                # 确保配置文件包含所需的所有选项
                if not cp.has_section('shutdown'):
                    cp.add_section('shutdown')
                if not cp.has_option('shutdown', 'time'):
                    cp.set('shutdown', 'time', '23:00:00')
                if not cp.has_option('shutdown', 'enabled'):
                    cp.set('shutdown', 'enabled', 'true')
                # 保存更新后的配置
                with open(filename, 'w', encoding=enc) as f:
                    cp.write(f)
                return cp, enc
        except Exception:
            continue
    raise Exception('无法读取配置文件，请检查编码格式。')

def get_shutdown_time(cp):
    time_str = cp.get('shutdown', 'time')
    # 只取时分秒
    return datetime.strptime(time_str, '%H:%M:%S').time()

def get_shutdown_enabled(cp):
    return cp.getboolean('shutdown', 'enabled', fallback=True)

def set_shutdown_time(cp, enc, new_time):
    cp.set('shutdown', 'time', new_time)
    with open(CONFIG_FILE, 'w', encoding=enc) as f:
        cp.write(f)

def set_shutdown_enabled(cp, enc, enabled):
    cp.set('shutdown', 'enabled', str(enabled).lower())
    with open(CONFIG_FILE, 'w', encoding=enc) as f:
        cp.write(f)

def create_image(enabled=True):
    img = Image.new('RGB', (64, 64), color=(255, 255, 255))
    d = ImageDraw.Draw(img)
    if enabled:
        # 激活状态：红色
        d.rectangle([16, 16, 48, 48], fill=(255, 0, 0))
        d.text((20, 20), '开', fill=(255, 255, 255))
    else:
        # 未激活状态：灰色
        d.rectangle([16, 16, 48, 48], fill=(128, 128, 128))
        d.text((20, 20), '停', fill=(255, 255, 255))
    return img

def show_config_dialog(icon, cp, enc, update_shutdown_time_callback):
    def on_ok():
        new_time = entry.get()
        try:
            # 验证时间格式
            datetime.strptime(new_time, '%H:%M:%S')
            set_shutdown_time(cp, enc, new_time)
            update_shutdown_time_callback(new_time)
            messagebox.showinfo('成功', '关机时间已更新！')
            root.destroy()
        except Exception:
            messagebox.showerror('错误', '时间格式应为：HH:MM:SS（24小时制）')
    root = tk.Tk()
    root.withdraw()
    root.title('设置关机时间')
    root.geometry('300x100')
    root.deiconify()
    tk.Label(root, text='请输入关机时间 (HH:MM:SS 24小时制):').pack(pady=5)
    entry = tk.Entry(root, width=25)
    entry.insert(0, cp.get('shutdown', 'time'))
    entry.pack(pady=5)
    tk.Button(root, text='确定', command=on_ok).pack(pady=5)
    root.mainloop()

def shutdown_watcher(shutdown_t):
    cp, enc = read_config(CONFIG_FILE)
    while not exit_event.is_set():
        # 检查是否启用
        if not get_shutdown_enabled(cp):
            time.sleep(10)  # 如果未启用，每10秒检查一次状态
            continue

        now = datetime.now()
        today_shutdown = datetime.combine(now.date(), shutdown_t[0])
        if now >= today_shutdown:
            # 如果已过关机时间，则等到明天
            today_shutdown += timedelta(days=1)
        wait_seconds = (today_shutdown - now).total_seconds()
        if wait_seconds > 0:
            # 使用更小的sleep间隔，以便能及时响应退出信号
            for _ in range(int(min(wait_seconds, 10) * 2)):
                if exit_event.is_set():
                    return
                time.sleep(0.5)
        else:
            print('到达关机时间，正在关机...')
            os.system('shutdown /s /t 0')
            break

def main():
    cp, enc = read_config(CONFIG_FILE)
    shutdown_time = [cp.get('shutdown', 'time')]
    shutdown_t = [get_shutdown_time(cp)]
    enabled = [get_shutdown_enabled(cp)]

    def update_shutdown_time(new_time):
        shutdown_time[0] = new_time
        shutdown_t[0] = datetime.strptime(new_time, '%H:%M:%S').time()

    def toggle_enabled(icon, item):
        enabled[0] = not enabled[0]
        set_shutdown_enabled(cp, enc, enabled[0])
        icon.icon = create_image(enabled[0])
        icon.title = get_tooltip()  # 立即更新提示信息

    def on_click(icon, item=None):
        show_config_dialog(icon, cp, enc, update_shutdown_time)

    def get_tooltip():
        status = "✅ 已激活" if enabled[0] else "⭕ 已停用"
        return f'⏰ 定时关机\n━━━━━━━━\n{status}\n⏱ 设定时间: {shutdown_time[0]}'

    # 启动关机监控线程
    shutdown_thread = threading.Thread(target=shutdown_watcher, args=(shutdown_t,), daemon=True)
    shutdown_thread.start()

    # 创建托盘图标（在主线程中运行）
    icon = pystray.Icon('ShutdownTimer')
    icon.icon = create_image(enabled[0])
    icon.title = get_tooltip()  # 确保初始提示信息正确
    icon.menu = pystray.Menu(
        item('设置关机时间', lambda icon, item: show_config_dialog(icon, cp, enc, update_shutdown_time)),
        item('激活/停用', toggle_enabled, checked=lambda item: enabled[0]),
        item('退出', lambda icon, item: icon.stop())
    )

    def update_tooltip():
        while icon.visible and not exit_event.is_set():
            icon.title = get_tooltip()  # 使用最新的enabled状态
            time.sleep(2)

    tooltip_thread = threading.Thread(target=update_tooltip, daemon=True)
    tooltip_thread.start()

    icon._on_click = on_click
    try:
        icon.run()
    finally:
        exit_event.set()  # 确保在托盘图标关闭时，所有线程都能正确退出

if __name__ == '__main__':
    main() 