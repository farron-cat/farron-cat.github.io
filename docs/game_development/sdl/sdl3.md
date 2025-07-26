# SDL3

sdl3

扩展库：
sdl3_image
sdl3_mixer
sdl3_ttf

## windows下的环境安装配置(从源码编译)
1. 在[sdl3](https://github.com/libsdl-org/SDL)
   [sdl3_image](https://github.com/libsdl-org/SDL_image/releases)
   [sdl3_mixer](https://github.com/libsdl-org/SDL_mixer/releases)
   [sdl3_ttf](https://github.com/libsdl-org/SDL_ttf/releases)
下载源码(版本号选择3.x)。使用git clone或者直接在release中下载源码包(或者直接下载编译好的devel包如果有)
2. 使用vscode(或其他编辑器、IDE)打开，配置cmake编译工具链，执行cmake生成
3. 在生成文件夹build中找到cmake_install.cmake,可以进入其中修改CMAKE_INSTALL_PREFIX为安装位置
4. 使用ctrl+shift+p打开操作面板，执行cmake安装
5. 将目标安装位置的文件夹内容合并到一个文件夹SDL3中
6. 将SDL3文件夹路径添加到环境变量的Path中
```
X:\{your path}\SDL3
X:\{your path}\SDL3\lib
```

## Ubuntu
终端执行
```bash
sudo apt install libsdl3-dev libsdl3-image-dev libsdl3-mixer-dev libsdl3-ttf-dev
```

## MacOS
安装homebrew后到终端执行
```bash
brew install sdl3 sdl3_image sdl3_mixer sdl3_ttf
```

## CMake中添加支持
CMakeLists.txt中加入
```cmake
find_package(SDL3 REQUIRED)
find_package(SDL3_image REQUIRED)
find_package(SDL3_mixer REQUIRED)
find_package(SDL3_ttf REQUIRED)
target_link_libraries(${TARGET}
                        ${SDL3_LIBRARIES}
                        SDL3_image::SDL3_image
                        SDL3_mixer::SDL3_mixer
                        SDL3_ttf::SDL3_ttf
)
```

