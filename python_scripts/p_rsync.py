import argparse
import os
import subprocess
import sys
import platform
import io
from pprint import pprint

import signal
import threading
from concurrent.futures import ThreadPoolExecutor

# 全局变量跟踪子进程
processes = []
processes_lock = threading.Lock()

def signal_handler(sig, frame):
    """捕获 Ctrl+C 并终止所有子进程及子进程树"""
    pprint(processes)
    sys.stdout.flush()  # 手动刷新
    with processes_lock:
        if not processes:
            print("\n无运行中的子进程.")
            sys.stdout.flush()  # 手动刷新
            sys.exit(0)

        print("\n正在终止所有子进程...")
        sys.stdout.flush()  # 手动刷新
        for proc in processes:
            pprint(processes)
            sys.stdout.flush()  # 手动刷新
            proc.terminate()


        # 等待所有进程实际终止
        for proc in processes:
            proc.wait()

        processes.clear()
    print("所有进程已终止.")
    sys.stdout.flush()  # 手动刷新
    sys.exit(0)


# 注册信号处理函数
signal.signal(signal.SIGINT, signal_handler)


def new_run_rsync(src_dir, target_root):
    try:
        target_dir = target_root.rstrip('/') + src_dir

        dst_path = target_dir
        if platform.system() == 'Windows':
            dst_path = unix_to_windows_path(target_dir)

        os.makedirs(dst_path, exist_ok=True)
        cmd = [
            'rsync',
            '-rvhn',
            '--size-only',
            src_dir.rstrip('/') + '/',
            target_dir
        ]
        # 使用 Popen 替代 run，以便获取进程对象
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='ignore'
        )
        # 将进程添加到全局列表（线程安全）
        with processes_lock:
            processes.append(proc)

        # 等待进程完成并捕获输出
        stdout, _ = proc.communicate()

        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, cmd, output=stdout)
        print(f"✅ Success: {src_dir}")
        sys.stdout.flush()  # 手动刷新
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed: {src_dir}\nError: {e.output}")
        sys.stdout.flush()  # 手动刷新
        return False
    finally:
        # 进程结束后从列表移除
        with processes_lock:
            if proc in processes:
                processes.remove(proc)


def change_default_encoding():
    """判断是否在 windows git-bash 下运行，是则使用 utf-8 编码"""
    if platform.system() == 'Windows':
        terminal = os.environ.get('TERM')
        if terminal and 'xterm' in terminal:
            sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')



def unix_to_windows_path(unix_path: str, keep_case: bool = False) -> str:
    """
    将类Unix路径（如 /q/dell/c/pdi6）转换为Windows盘符路径（如 q:/dell/c/pdi6）

    :param unix_path: 输入的类Unix路径
    :param keep_case: 是否保留盘符大小写（默认转为小写）
    :return: 转换后的Windows路径（使用正斜杠）
    """
    # 分割路径并过滤空段
    parts = [p for p in unix_path.strip('/').split('/') if p]
    if not parts:
        return '/'  # 若输入为根目录，返回空或根目录标识

    # 提取盘符（假设首段为盘符）
    drive_part = parts[0]
    if len(drive_part) != 1:
        raise ValueError(f"Invalid drive '{drive_part}': Drive must be a single character.")

    # 处理盘符大小写
    drive = drive_part.upper() + ':' if keep_case else drive_part.lower() + ':'

    # 拼接剩余路径段
    remaining_path = '/'.join(parts[1:]) if len(parts) > 1 else ''
    windows_path = f"{drive}/{remaining_path}"

    # 规范化路径并统一使用正斜杠
    normalized = os.path.normpath(windows_path).replace('\\', '/')
    return normalized



def read_backup_list(file_path):
    """读取备份目录列表文件，过滤空行和注释"""
    directories = []
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                directories.append(line)
    return directories


def run_rsync(src_dir, target_root):
    """执行单个 rsync 备份任务"""
    try:
        # 处理路径格式，确保正确的同步行为
        target_dir = target_root.rstrip('/') + src_dir

        dst_path = unix_to_windows_path(target_dir)

        os.makedirs(dst_path, exist_ok=True)

        # 构建 rsync 命令
        cmd = [
            'rsync',
            '-rvhn',
            '--size-only',
            src_dir,
            target_dir
        ]

        # pprint(cmd)
        # 执行命令并捕获输出
        sys.stdout.flush()  # 手动刷新
        result = subprocess.run(
            cmd,
            check=True,
            stdout=subprocess.PIPE,
            stderr= subprocess.STDOUT,
            text=True,
            encoding='utf-8',  # 明确指定编码为utf-8
            errors='ignore'     # 忽略无法解码的字符（可选）
        )
        print(f"✅ Success: {src_dir}")
        sys.stdout.flush()  # 手动刷新
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed: {src_dir}\nError: {e.stdout}")
        sys.stdout.flush()  # 手动刷新
        return False

def main():
    parser = argparse.ArgumentParser(
        description='Parallel rsync backup tool',
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    parser.add_argument(
        '-l', '--list',
        required=True,
        help='Path to file containing directory list to backup'
    )
    parser.add_argument(
        '-t', '--target',
        required=True,
        help='Root directory for backups'
    )
    parser.add_argument(
        '-j', '--jobs',
        type=int,
        default=4,
        help='Number of parallel jobs'
    )

    args = parser.parse_args()

    # 读取备份目录列表
    try:
        directories = read_backup_list(args.list)
        print(f"📄 Found {len(directories)} directories to backup")
    except Exception as e:
        print(f"🚨 Error reading list file: {str(e)}")
        return

    # 创建线程池执行任务
    with ThreadPoolExecutor(max_workers=args.jobs) as executor:
        futures = []
        for idx, src_dir in enumerate(directories, 1):
            print(f"🔄 Queueing ({idx}/{len(directories)}): {src_dir}")
            sys.stdout.flush()  # 手动刷新
            futures.append(executor.submit(new_run_rsync, src_dir, args.target))

        # 等待所有任务完成
        success = 0
        for future in futures:
            if future.result():
                success += 1
        print(f"\n📊 Backup complete! Success: {success}/{len(directories)}")
        sys.stdout.flush()  # 手动刷新

if __name__ == '__main__':
    change_default_encoding()

    main()

