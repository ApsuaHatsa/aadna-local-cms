import matter from 'gray-matter';
const data = {
  overview: `| Уровень | SNP | Описание |\n\n| ------------- | -------------------------------------------------------\n| ------------------ |\n\n| Основная | R1a | Гаплогруппа *снип* |`
};
console.log("LINE WIDTH -1 WITH MIXED NEWLINES:");
console.log(matter.stringify('', data, { lineWidth: -1 }));
