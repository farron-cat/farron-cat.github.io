import{_ as n,c as t,o as p,j as e}from"./chunks/framework.U1Gow_7P.js";const u=JSON.parse('{"title":"","description":"","frontmatter":{},"headers":[],"relativePath":"game_development/opengl/glfw&glew.md","filePath":"game_development/opengl/glfw&glew.md"}'),a={name:"game_development/opengl/glfw&glew.md"};function o(r,l,s,d,g,m){return p(),t("div",null,l[0]||(l[0]=[e("p",null,"使用二者的来由 由于OpenGL本身只是图形渲染api，并不涉及其他方面的功能 不负责创建应用程序窗口 不负责处理操作系统消息（事件循环 不负责处理输入",-1),e("pre",null,[e("code",null,`由于OpenGL驱动由显卡厂商提供，不同显卡、不同驱动版本的核心功能和扩展功能差异大
    核心函数位置可能不同
    高级功能以扩展形式引入，并非所有硬件支持
    操作系统提供的头文件通常只有函数声明，没有具体函数指针（函数实现在运行时才能确定
`)],-1),e("p",null,"GLFW 使用GLFW来创建和管理窗口、上下文和处理输入 负责“画板”",-1),e("p",null,'GLEW 使用来自动加载函数指针、检查功能支持和简化扩展运用 负责"简化加载扩展代码的操作"',-1),e("p",null,"使用流程",-1),e("p",null,"替代品 GLFW -- SDL GLEW -- GLAD",-1),e("p",null,"GLEW头文件要在GLFW头文件前面的原因",-1)]))}const _=n(a,[["render",o]]);export{u as __pageData,_ as default};
