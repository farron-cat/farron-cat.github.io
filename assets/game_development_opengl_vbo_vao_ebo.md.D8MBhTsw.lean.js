import{_ as t,c as r,o,j as e}from"./chunks/framework.Ck3L_38O.js";const f=JSON.parse('{"title":"","description":"","frontmatter":{},"headers":[],"relativePath":"game_development/opengl/vbo&vao&ebo.md","filePath":"game_development/opengl/vbo&vao&ebo.md"}'),l={name:"game_development/opengl/vbo&vao&ebo.md"};function a(p,n,O,s,B,V){return o(),r("div",null,[...n[0]||(n[0]=[e("p",null,"在OpenGL中，VBO（Vertex Buffer Object）、VAO（Vertex Array Object） 和 EBO（Element Buffer Object） 是优化渲染性能的核心技术，它们共同管理顶点数据并减少CPU-GPU通信 VBO 顶点缓冲对象（Vertex Buffer Objects 作用 存储顶点属性数据（位置、颜色、法线、纹理坐标等）",-1),e("pre",null,[e("code",null,`功能
    将顶点数据一次性上传到显存（GPU），避免每帧重复传输
    支持非交错（position + color 分开存储）或交错（混合存储）数据布局

创建
    使用glGenBuffers函数生成带有缓冲ID的VBO对象

使用
    在VAO绑定后
    使用glBindBuffer函数把新创建的缓冲绑定到GL_ARRAY_BUFFER目标上
    调用glBufferData函数，它会把之前定义的顶点数据复制到缓冲的内存中
    解绑
`)],-1),e("p",null,"VAO 顶点数组对象 （Vertex Array Object 作用 封装顶点数据配置（VBO、EBO的绑定和属性解释规则）。",-1),e("pre",null,[e("code",null,`功能：
    存储对VBO/EBO的引用，以及如何解析顶点数据的规则（如glVertexAttribPointer）
    渲染时只需绑定VAO即可恢复全部顶点状态，大幅简化代码

创建
    使用glGenVertexArrays函数生成VAO对象

使用
    使用glBindVertexArray绑定VAO
    绑定和配置对应的VBO和属性指针
    解绑VAO供之后使用
`)],-1),e("p",null,"EBO",-1)])])}const d=t(l,[["render",a]]);export{f as __pageData,d as default};
