# Spdlog

## Spdlog 安装配置

### windows
1. 在[spdlog官方仓库](https://github.com/gabime/spdlog)下载源码。使用git clone或者直接在release中下载源码包
2. 使用vscode(或其他编辑器、IDE)打开，配置cmake编译工具链，执行cmake生成
3. 在生成文件夹build中找到cmake_install.cmake,可以进入其中修改CMAKE_INSTALL_PREFIX为安装位置
4. 使用ctrl+shift+p打开操作面板，执行cmake安装
5. 将目标安装位置的文件夹路径添加到环境变量的Path中
```
X:\{your path}\spdlog
```

### Ubuntu
终端执行
```bash
sudo apt install libspdlog-dev
```

### MacOS
安装homebrew后到终端执行
```bash
brew install spdlog
```

### CMake中添加支持
CMakeLists.txt中加入
```cmake
find_package(spdlog REQUIRED)
target_link_libraries(${TARGET} spdlog::spdlog)
```

## Spdlog 使用示例

### 使用示例
```cpp
#include <spdlog/spdlog.h>

int main(int, char**) {
    // 设置日志等级，不设置的话默认为 info
    spdlog::set_level(spdlog::level::err);

    // 不同等级的log
    spdlog::trace("最低级别log!");
    spdlog::debug("调试信息!");
    spdlog::info("你好，世界!");
    spdlog::warn("警告!，很可能会出错");
    spdlog::error("程序出错啦!");
    spdlog::critical("最高级别的log!, 比error还严重!");

    // 格式化输出
    spdlog::info("日志格式化输出: {} {} {}", 1, "hello", 3.14);

    return 0;
}
```