import os
import io
import sys
import platform

def change_default_encoding():
    """判断是否在 windows git-bash 下运行，是则使用 utf-8 编码"""
    if platform.system() == 'Windows':
        terminal = os.environ.get('TERM')
        if terminal and 'xterm' in terminal:
            sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def find_file_by_inode(target_inode, search_path="./"):
    for root, dirs, files in os.walk(search_path):
        for name in files + dirs:
            path = os.path.join(root, name)
            try:
                inode = os.stat(path).st_ino
                if inode == target_inode:
                    return path
            except FileNotFoundError:
                continue  # 处理符号链接失效等情况
    return None

# 使用示例
change_default_encoding()
target_inode = int(sys.argv[1])
file_path = find_file_by_inode(target_inode)
if file_path:
    print(file_path)
    name, extension = os.path.splitext(file_path)
    print(name)
    print(extension)
    #with open(file_path, 'r') as f:
    #    print(f"文件内容：{f.read()}")
else:
    print("未找到对应 inode 的文件")
