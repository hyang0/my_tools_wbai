import os
import io
import sys
import platform

def get_filename_bytes(filename):
    """获取文件名的字节长度"""
    # 获取文件系统编码（通常为 utf-8/mbcs）
    fs_encoding = sys.getfilesystemencoding()
    
    # 转换为字节序列
    try:
        byte_name = filename.encode(fs_encoding)
    except UnicodeEncodeError:
        # 处理无法编码的字符（替换为?）
        byte_name = filename.encode(fs_encoding, errors='replace')
    
    return len(byte_name)


def change_default_encoding():
    """判断是否在 windows git-bash 下运行，是则使用 utf-8 编码"""
    if platform.system() == 'Windows':
        terminal = os.environ.get('TERM')
        if terminal and 'xterm' in terminal:
            sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


import os
from pathlib import Path

def safe_truncate(filename, max_length=30):
    """智能截断文件名，保留扩展名"""
    stem, suffix = os.path.splitext(filename)
    
    # 计算可用主干长度
    available = max_length - len(suffix)
    if available <= 0:  # 扩展名超过最大长度
        return filename[:max_length]  # 强制截断
    
    # 截断主干并组合
    truncated_stem = stem[:available]
    return f"{truncated_stem}{suffix}"

def make_unique(path):
    """为重复文件名添加序号"""
    counter = 1
    while path.exists():
        stem = path.stem.rstrip(f"_{counter-1}")
        new_name = f"{stem}_{counter}{path.suffix}"
        path = path.with_name(new_name)
        counter += 1
    return path

def process_file(file_path, max_length=200):
    """处理单个文件"""
    #print(get_filename_bytes(file_path.name))
    if get_filename_bytes(file_path.name) <= max_length:
        return
    
    # 生成新文件名
    new_name = safe_truncate(file_path.name, 20)
    new_path = file_path.with_name(new_name)
    
    # 处理重名并重命名
    new_path = make_unique(new_path)
    try:
        file_path.rename(new_path)
        print(f"Origin Path: {file_path}")
        print(f"Renamed: {file_path.name} -> {new_path.name}")
        print()
    except Exception as e:
        print(f"Error renaming {file_path}: {str(e)}")

def scan_directory(root_dir):
    """递归扫描目录"""
    for path in Path(root_dir).rglob('*'):
        if path.is_file():
            process_file(path)
        elif path.is_dir() and len(path.name) > 255:
            print(f"Warning: Directory name too long: {path}")


if __name__ == "__main__":
    change_default_encoding()
    scan_directory(sys.argv[1])
