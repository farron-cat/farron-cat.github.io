# SDL2

sdl2

扩展库：
sdl2_image
sdl2_mixer
sdl2_ttf

## windows下的环境安装配置(从源码编译)
1. 在[sdl2](https://github.com/libsdl-org/SDL)
   [sdl2_image](https://github.com/libsdl-org/SDL_image/releases)
   [sdl2_mixer](https://github.com/libsdl-org/SDL_mixer/releases)
   [sdl2_ttf](https://github.com/libsdl-org/SDL_ttf/releases)
   下载源码(版本号选择2.x)。使用git clone或者直接在release中下载源码包(或者直接下载编译好的devel包如果有)
2. 使用vscode(或其他编辑器、IDE)打开，配置cmake编译工具链，执行cmake生成
3. 在生成文件夹build中找到cmake_install.cmake,可以进入其中修改CMAKE_INSTALL_PREFIX为安装位置
4. 使用ctrl+shift+p打开操作面板，执行cmake安装
5. 将目标安装位置的文件夹内容合并到一个文件夹SDL2中
6. 将SDL2文件夹路径添加到环境变量的Path中
```
X:\{your path}\SDL2
X:\{your path}\SDL2\lib
```

## Ubuntu
终端执行
```bash
sudo apt install libsdl2-dev libsdl2-image-dev libsdl2-mixer-dev libsdl2-ttf-dev
```

## MacOS
安装homebrew后到终端执行
```bash
brew install sdl2 sdl2_image sdl2_mixer sdl2_ttf
```

## CMake中添加支持
CMakeLists.txt中加入
```cmake
find_package(SDL2 REQUIRED)
find_package(SDL2_image REQUIRED)
find_package(SDL2_mixer REQUIRED)
find_package(SDL2_ttf REQUIRED)
target_link_libraries(${TARGET}
                        ${SDL2_LIBRARIES}
                        ${SDL2_IMAGE_LIBRARIES}
                        ${SDL2_MIXER_LIBRARIES}
                        ${SDL2_TTF_LIBRARIES}
)
```

