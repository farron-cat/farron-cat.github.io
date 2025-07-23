# 绘制三角形

## 1.准备工作
-  初始化和配置GLFW
```c++
//1.GLFW初始化和配置
glfwInit();
//将OpenGl版本号设置为3.3
glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
//使用核心模式
glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
```
-  创建GLFW窗口
```c++
//2.使用GLFW创建窗口对象
GLFWwindow* window = glfwCreateWindow(800, 600, "LearnOpenGL", NULL, NULL);
if (window == NULL)
{
    std::cout << "failed to create GLFW window" << std::endl;
    glfwTerminate();
    return -1;
}
//通知GLFW将窗口的上下文设置为当前线程的上下文
glfwMakeContextCurrent(window);
//改变窗口大小时，视口同步改变
glfwSetFramebufferSizeCallback(window, framebuffer_size_callback);
```
回调函数
```c++
void framebuffer_size_callback(GLFWwindow* window, int width, int height)
{
    glViewport(0, 0, width, height);
}
```

-  初始化GLAD
```c++
//3.初始化GLAD，载入所有OpenGL函数指针
if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress))
{
    std::cout << "failed to initialized GLAD" << std::endl;
    return -1;
}
```
## 2.构建和编译着色器
-  编写着色器源码

编写顶点着色器
```glsl
#version 330 core
layout (location = 0) in vec3 aPos;
out vec4 vertexColor;
void main()
{
   gl_Position = vec4(aPos, 1.0);
   vertexColor = vec4(0.5, 0.0, 0.0, 1.0);
}
```
编写片段着色器
```glsl
#version 330 core
in vec4 vertexColor;
out vec4 FragColor;
uniform vec4 ourColor;
void main()
{
   //FragColor = vertexColor;//RGBA
   FragColor = ourColor;
}
```
暂时先使用字符串存储着色器源码
```c++
//顶点着色器源码
const char* vertexShaderSource =
"#version 330 core\n"
"layout (location = 0) in vec3 aPos;\n"
"out vec4 vertexColor;\n"
"void main()\n"
"{\n"
"   gl_Position = vec4(aPos, 1.0);\n"
"   vertexColor = vec4(0.5, 0.0, 0.0, 1.0);\n"
"}\0";

//片段着色器源码
const char* fragmentShaderSource =
"#version 330 core\n"
"in vec4 vertexColor;\n"
"out vec4 FragColor;\n"
"uniform vec4 ourColor;\n"
"void main()\n"
"{\n"
"   //FragColor = vertexColor;\n" //RGBA
"   FragColor = ourColor;\n" 
"}\0";
```


-  编译
    -  创建顶点着色器对象和片段着色器对象
    -  载入源码
    -  编译
```c++
//4.指示如何处理，构造和编译着色器
//顶点着色器
unsigned int vertexShader;
vertexShader = glCreateShader(GL_VERTEX_SHADER);//创建顶点着色器对象，并记录其ID
glShaderSource(vertexShader, 1, &vertexShaderSource, NULL);//将着色器源码附加到顶点着色器对象中
glCompileShader(vertexShader);//编译着色器对象

//片段着色器 计算像素最后的颜色输出
unsigned int fragmentShader;
fragmentShader = glCreateShader(GL_FRAGMENT_SHADER);
glShaderSource(fragmentShader, 1, &fragmentShaderSource, NULL);
glCompileShader(fragmentShader);
```

-  链接
    - 创建着色器程序对象
    - 附加顶点着色器对象和片段着色器对象到程序对象
    - 链接着色器程序对象
    - 清除着色器对象
```c++
//链接为着色器程序对象
unsigned int shaderProgram;
shaderProgram = glCreateProgram();//创建着色器程序对象
glAttachShader(shaderProgram, vertexShader);//附加顶点着色器对象
glAttachShader(shaderProgram, fragmentShader);//附加片段着色器对象
glLinkProgram(shaderProgram);//链接

//删除着色器对象
glDeleteShader(vertexShader);
glDeleteShader(fragmentShader);
```

## 3.输入顶点数据和定义顶点数据解析方式

```c++
//5.设置顶点数据和缓冲，配置顶点属性
unsigned int VBO;//把顶点数据储存在显卡的内存中，用VBO这个顶点缓冲对象管理
unsigned int VAO;//使用VAO间接绑定VBO中的顶点数据
unsigned int EBO;

glGenBuffers(1, &VBO);//生成1个缓冲对象，并用VBO变量记录其ID
glGenVertexArrays(1, &VAO);
glGenBuffers(1, &EBO);

//(1.绑定VAO,激活配置模式
glBindVertexArray(VAO);
//(2.把顶点数组复制到缓冲中供OpenGL使用
glBindBuffer(GL_ARRAY_BUFFER, VBO);//VAO关联VBO,将VBO绑定到GL_ARRAY_BUFFER目标上
glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);//将顶点数据复制到VBO的内存中

glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, EBO);
glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(indices), indices, GL_STATIC_DRAW);


//(3.设置顶点属性指针
//指示如何解析顶点数据
glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 3 * sizeof(float), (void*)0);//参数6？
//以顶点属性位置值作为参数，启用顶点属性
glEnableVertexAttribArray(0);

//解绑供之后使用
glBindBuffer(GL_ARRAY_BUFFER, 0);
glBindVertexArray(0);
```
## 4.编写渲染循环
-  输入控制
```c++
void processInput(GLFWwindow* window)
{
    if (glfwGetKey(window, GLFW_KEY_ESCAPE) == GLFW_PRESS)
        glfwSetWindowShouldClose(window, true);
}
```
-  渲染
    - 设置和清空颜色缓冲
    - 激活着色器程序对象
    - 绑定VAO
    - 绘制三角形

```c++
while (!glfwWindowShouldClose(window))
{
    //输入控制
    processInput(window);

    //渲染
    glClearColor(0.2f, 0.3f, 0.3f, 1.0f);//设置清空颜色缓冲后的颜色
    glClear(GL_COLOR_BUFFER_BIT);//使用上一句的设置来清空颜色缓冲
    //绘制三角形
    glUseProgram(shaderProgram);//激活着色器程序对象，此后每个着色器调用和渲染调用都会使用这个程序对象

    float timeValue = glfwGetTime();
    float greenValue = (sin(timeValue) / 2.0f) + 0.5f;
    int vertexColorLocation = glGetUniformLocation(shaderProgram, "ourColor");
    glUniform4f(vertexColorLocation, 0.0f, greenValue, 0.0f, 1.0f);
    glBindVertexArray(VAO);
    glDrawArrays(GL_TRIANGLES, 0, 3);//绘制三角形
    glBindVertexArray(0);

    //检查并调用事件，交换缓冲......
}
```

-  检查并调用事件，交换缓冲
```c++
//交换颜色缓冲（在此处用来绘制屏幕颜色，不写是白色的屏幕
glfwSwapBuffers(window);
//检查事件触发(不写窗口是类似无响应的状态
glfwPollEvents();
```
## 5.释放资源
-  释放VAO VBO 着色器程序对象
```c++  
//7.释放资源
//一旦所有资源超出其使用目的，就释放其资源分配
glDeleteVertexArrays(1, &VAO);
glDeleteBuffers(1, &VBO);
glDeleteProgram(shaderProgram);

```
-  释放GLFW资源
```c++
glfwTerminate();//清理所有GLFW资源
```

