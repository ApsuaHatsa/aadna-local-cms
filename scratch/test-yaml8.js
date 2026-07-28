import matter from 'gray-matter';
const data = {
  overview: `\n| Уровень | SNP | Описание |\n\n| ------------- | -------------------------------------------------------\n| ------------------ |\n\n| Основная | R1a | Гаплогруппа *снип* |`
};
console.log("LINE WIDTH -1 WITH LEADING NEWLINE:");
console.log(matter.stringify('', data, { lineWidth: -1 }));
