# glm

## windows下的环境安装配置
1. 在[glm官方仓库](https://github.com/g-truc/glm)下载源码。使用git clone或者直接在release中下载源码包
2. 使用vscode(或其他编辑器、IDE)打开，配置cmake编译工具链，执行cmake生成
3. 在生成文件夹build中找到cmake_install.cmake,可以进入其中修改CMAKE_INSTALL_PREFIX为安装位置
4. 使用ctrl+shift+p打开操作面板，执行cmake安装
5. 将目标安装位置的文件夹路径添加到环境变量的Path中
```
X:\{your path}\glm
X:\{your path}\glm\lib
```

## Ubuntu
终端执行
```bash
sudo apt install libglm-dev
```

## MacOS
安装homebrew后到终端执行
```bash
brew install glm
```

## CMake中添加支持
CMakeLists.txt中加入
```cmake
find_package(glm CONFIG REQUIRED)
target_link_libraries(${TARGET} glm::glm)
```
