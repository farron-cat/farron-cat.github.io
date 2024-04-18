import{_ as n,D as _,c as u,l,a as i,I as o,w as e,a3 as t,o as r}from"./chunks/framework.CEsZRhzZ.js";const tl=JSON.parse('{"title":"第三章 栈和队列","description":"","frontmatter":{},"headers":[],"relativePath":"programming/data_structure/chap3.md","filePath":"programming/data_structure/chap3.md"}'),h={name:"programming/data_structure/chap3.md"},s=t("",3),c=l("li",null,"栈顶 栈底 空栈",-1),d=l("li",null,"后进先出 LIFO",-1),f=t("",3),p={id:"顺序栈",tabindex:"-1"},T=l("a",{class:"header-anchor",href:"#顺序栈","aria-label":'Permalink to "<font color=#40A8F5>顺序栈</font>"'},"​",-1),b=t("",1),m={id:"链栈",tabindex:"-1"},P=l("a",{class:"header-anchor",href:"#链栈","aria-label":'Permalink to "<font color=#40A8F5>链栈</font>"'},"​",-1),g=l("ul",null,[l("li",null,"定义 ![图片](./第三章 栈和队列-幕布图片-145986-818194.jpg)"),l("li",null,[i("基本操作 "),l("ul",null,[l("li",null,"初始化 ![图片](./第三章 栈和队列-幕布图片-59910-602976.jpg)"),l("li",null,"入栈 在表头进行 ![图片](./第三章 栈和队列-幕布图片-855482-77593.jpg)"),l("li",null,"出栈 在表头进行 ![图片](./第三章 栈和队列-幕布图片-599591-800503.jpg)"),l("li",null,"返回栈顶 ![图片](./第三章 栈和队列-幕布图片-745905-458574.jpg)"),l("li",null,"判空 指针为空即为空栈")])]),l("li",null,"特点")],-1),A={id:"共享栈-特殊顺序栈",tabindex:"-1"},S=l("a",{class:"header-anchor",href:"#共享栈-特殊顺序栈","aria-label":'Permalink to "<font color=#40A8F5>共享栈 （特殊顺序栈）</font>"'},"​",-1),q=t("",7),x={id:"顺序队列-循环队列",tabindex:"-1"},j=l("a",{class:"header-anchor",href:"#顺序队列-循环队列","aria-label":'Permalink to "<font color=#40A8F5>顺序队列</font> <font color=#DC2D1E>(循环队列)</font>"'},"​",-1),k=l("li",null,"定义 ![图片](./第三章 栈和队列-幕布图片-273905-447249.jpg)",-1),D=l("li",null,[i("基本操作 "),l("ul",null,[l("li",null,"初始化 ![图片](./第三章 栈和队列-幕布图片-153702-801935.jpg)"),l("li",null,"入队 ![图片](./第三章 栈和队列-幕布图片-119577-439167.jpg)"),l("li",null,"出队 ![图片](./第三章 栈和队列-幕布图片-845752-635350.jpg)"),l("li",null,"判空 ![图片](./第三章 栈和队列-幕布图片-10649-958879.jpg)")])],-1),C=l("li",null,"判空条件：首 == 尾",-1),V=l("li",null,[i("队尾指针rear指向队尾元素时 "),l("ul",null,[l("li",null,"队空和队满都为：尾循环加一==首"),l("li",null,"要借助size或者tag（如下）")])],-1),I=l("li",null,"设置变量size记录队列大小",-1),E=l("li",null,"rear队尾指针指向队尾元素时",-1),F={id:"链队列",tabindex:"-1"},N=l("a",{class:"header-anchor",href:"#链队列","aria-label":'Permalink to "<font color=#40A8F5>链队列</font>"'},"​",-1),R=t("",1),z={id:"特殊队列-双端队列",tabindex:"-1"},O=l("a",{class:"header-anchor",href:"#特殊队列-双端队列","aria-label":'Permalink to "<font color=#40A8F5>特殊队列（双端队列）</font>"'},"​",-1),$=l("ul",null,[l("li",null,"输出受限的双端队列"),l("li",null,"输入受限的双端队列")],-1),v={id:"应用",tabindex:"-1"},B=l("a",{class:"header-anchor",href:"#应用","aria-label":'Permalink to "<font color=#DC2D1E>应用</font>"'},"​",-1),w=t("",4),y=l("li",null,"前缀表达式（波兰式）",-1),L=l("li",null,[l("blockquote",null,[l("ul",null,[l("li",null,"+ab *cd")])])],-1),M=l("li",null,"中缀表达式",-1),Q=l("li",null,[l("blockquote",null,[l("p",null,"a+b-c*d")])],-1),G=l("li",null,[l("blockquote",null,[l("p",null,"ab+ cd* -")])],-1),J=t("",1),H=t("",6),K={id:"※-特殊矩阵的压缩存储",tabindex:"-1"},U=l("a",{class:"header-anchor",href:"#※-特殊矩阵的压缩存储","aria-label":'Permalink to "<font color=#DC2D1E>※ 特殊矩阵的压缩存储</font>"'},"​",-1),W=t("",1);function X(Y,Z,ll,il,al,ol){const a=_("font");return r(),u("div",null,[s,l("ul",null,[l("li",null,[i("只允许在一端进行插入或删除操作的 "),o(a,{color:"#DC2D1E"},{default:e(()=>[i("线性表")]),_:1})]),c,d]),f,l("h4",p,[o(a,{color:"#40A8F5"},{default:e(()=>[i("顺序栈")]),_:1}),i(),T]),b,l("h4",m,[o(a,{color:"#40A8F5"},{default:e(()=>[i("链栈")]),_:1}),i(),P]),g,l("h4",A,[o(a,{color:"#40A8F5"},{default:e(()=>[i("共享栈 （特殊顺序栈）")]),_:1}),i(),S]),q,l("h4",x,[o(a,{color:"#40A8F5"},{default:e(()=>[i("顺序队列")]),_:1}),i(),o(a,{color:"#DC2D1E"},{default:e(()=>[i("(循环队列)")]),_:1}),i(),j]),l("ul",null,[k,D,l("li",null,[i("特点 "),l("ul",null,[l("li",null,[i("队尾指针rear指向队尾元素后一个位置时 "),l("ul",null,[C,l("li",null,[i("判满条件：尾循环加一 == 首 "),l("ul",null,[l("li",null,[i("Q.rear = (Q.rear + 1) % "),o(a,{color:"#FFAF38"},{default:e(()=>[i("MaxSize 模空间的长度，注意题中数组开始和结束下标")]),_:1})])])])])]),V,l("li",null,[o(a,{color:"#DC2D1E"},{default:e(()=>[i("避免浪费一个元素空间的方法")]),_:1}),l("ul",null,[I,l("li",null,[i("设置变量 "),o(a,{color:"#40A8F5"},{default:e(()=>[i("tag")]),_:1}),i(" 记录最近进行的操作（删除0/插入1） "),l("ul",null,[l("li",null,[i("队空：front==rear && "),o(a,{color:"#40A8F5"},{default:e(()=>[i("tag==0")]),_:1})]),l("li",null,[i("队满：front==rear && "),o(a,{color:"#40A8F5"},{default:e(()=>[i("tag==1")]),_:1})])])])])]),E])])]),l("h4",F,[o(a,{color:"#40A8F5"},{default:e(()=>[i("链队列")]),_:1}),i(),N]),R,l("h4",z,[o(a,{color:"#40A8F5"},{default:e(()=>[i("特殊队列（双端队列）")]),_:1}),i(),O]),$,l("h2",v,[o(a,{color:"#DC2D1E"},{default:e(()=>[i("应用")]),_:1}),i(),B]),w,l("ul",null,[l("li",null,[i("三种算数表达式 "),l("ul",null,[y,L,M,Q,l("li",null,[o(a,{color:"#DC2D1E"},{default:e(()=>[i("后缀表达式（逆波兰式）")]),_:1})]),G])]),J]),H,l("h2",K,[o(a,{color:"#DC2D1E"},{default:e(()=>[i("※ 特殊矩阵的压缩存储")]),_:1}),i(),U]),W])}const nl=n(h,[["render",X]]);export{tl as __pageData,nl as default};