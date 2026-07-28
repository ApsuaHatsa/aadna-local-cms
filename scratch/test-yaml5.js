import matter from 'gray-matter';
const data = {
  overview: `| Уровень | SNP | Описание |\n| ------------- | ---------------------------------------------------- | ------------------ |\n| Основная | I1 | Гаплогруппа *снип* |`
};
console.log("DEFAULT:");
console.log(matter.stringify('', data));
console.log("LINE WIDTH 20:");
console.log(matter.stringify('', data, { lineWidth: 20 }));
console.log("LINE WIDTH -1:");
console.log(matter.stringify('', data, { lineWidth: -1 }));
