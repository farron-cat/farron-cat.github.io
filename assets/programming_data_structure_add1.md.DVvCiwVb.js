import{_ as a,c as l,o as i,a3 as e}from"./chunks/framework.CEsZRhzZ.js";const f=JSON.parse('{"title":"广义表","description":"","frontmatter":{},"headers":[],"relativePath":"programming/data_structure/add1.md","filePath":"programming/data_structure/add1.md"}'),t={name:"programming/data_structure/add1.md"},r=e('<h1 id="广义表" tabindex="-1">广义表 <a class="header-anchor" href="#广义表" aria-label="Permalink to &quot;广义表&quot;">​</a></h1><h2 id="定义" tabindex="-1">定义 <a class="header-anchor" href="#定义" aria-label="Permalink to &quot;定义&quot;">​</a></h2><ul><li>是n(n&gt;0)个元素的有限序列，其中每一个元素或者是原子，或者是广义表 <ul><li>LS=(a1,a2,...,an)</li><li>LS为表名，n为表长度，ai为表的元素</li><li>表头：若LS非空，其第一个元素为其表头</li><li>表尾：除表头之外的其他元素组成的表为表尾</li></ul></li></ul><h2 id="性质" tabindex="-1">性质 <a class="header-anchor" href="#性质" aria-label="Permalink to &quot;性质&quot;">​</a></h2><ul><li>数据元素有相对次序（一个直接前驱和一个直接后继）</li><li>长度定义为最外层所包含元素的个数</li><li>深度定义为该广义表展开后所含括号的重数</li><li>广义表可以为其他表共享</li><li>广义表可以是一个递归的表 <ul><li>递归表深度无穷，长度有限</li></ul></li><li>是多层次结构</li></ul><h2 id="基本操作" tabindex="-1">基本操作 <a class="header-anchor" href="#基本操作" aria-label="Permalink to &quot;基本操作&quot;">​</a></h2><ul><li>GetHead(L)</li><li>GetTail(L)</li></ul><h2 id="存储结构" tabindex="-1">存储结构 <a class="header-anchor" href="#存储结构" aria-label="Permalink to &quot;存储结构&quot;">​</a></h2><ul><li>头尾链表存储表示 <ul><li>特点</li></ul></li><li>扩展线性链表存储表示</li><li>特点</li></ul><h2 id="与线性表的区别" tabindex="-1">与线性表的区别 <a class="header-anchor" href="#与线性表的区别" aria-label="Permalink to &quot;与线性表的区别&quot;">​</a></h2><h2 id="递归" tabindex="-1">递归 <a class="header-anchor" href="#递归" aria-label="Permalink to &quot;递归&quot;">​</a></h2>',11),o=[r];function d(n,h,u,s,c,_){return i(),l("div",null,o)}const b=a(t,[["render",d]]);export{f as __pageData,b as default};