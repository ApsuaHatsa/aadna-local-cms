import matter from 'gray-matter';
const data = {
  overview: `| Уровень | SNP | Описание |\n\n| ------------- | ---------------------------------------------------- | ------------------ |\n\n| Основная | I1 | Гаплогруппа *снип* |`
};
console.log("LINE WIDTH -1 WITH DOUBLE NEWLINES:");
console.log(matter.stringify('', data, { lineWidth: -1 }));
