# GLM
GLM (OpenGL Mathematics) 是一个基于OpenGL着色语言(GLSL)的C++数学库，它提供了一组常用的数学函数和类型，用于在OpenGL应用程序中进行图形计算。

GLM库的设计目标是提供简单易用、高性能的数学函数和类型，以便在OpenGL应用程序中实现各种图形算法。

## GLM 安装配置

### Windows
1. 在[glm官方仓库](https://github.com/g-truc/glm)下载源码。使用git clone或者直接在release中下载源码包
2. 使用vscode(或其他编辑器、IDE)打开，配置cmake编译工具链，执行cmake生成
3. 在生成文件夹build中找到cmake_install.cmake,可以进入其中修改CMAKE_INSTALL_PREFIX为安装位置
4. 使用ctrl+shift+p打开操作面板，执行cmake安装
5. 将目标安装位置的文件夹路径添加到环境变量的Path中
```
X:\{your path}\glm
X:\{your path}\glm\lib
```

### Ubuntu
终端执行
```bash
sudo apt install libglm-dev
```

### MacOS
安装homebrew后到终端执行
```bash
brew install glm
```

### CMake中添加支持
CMakeLists.txt中加入
```cmake
find_package(glm CONFIG REQUIRED)
target_link_libraries(${TARGET} glm::glm)
```

## GLM 使用示例

### 使用示例
```cpp
#include <glm/glm.hpp>

// 创建二维向量
glm::vec2 a = glm::vec2(1.0f, 2.0f);
glm::vec2 b = glm::vec2(3.0f, 4.0f);

// 向量乘法（分量相乘）
auto c = a * b;  // 结果: (3.0, 8.0)

// 计算向量间距离
auto d = glm::distance(a, b);

// 打印结果
SDL_Log("d = (%f)", d);
SDL_Log("c = (%f, %f)", c.x, c.y);
```
