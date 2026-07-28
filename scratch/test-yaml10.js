import matter from 'gray-matter';
const data = {
  overview: `| Уровень | SNP | Описание | \n| ------------- | ---------------------------------------------------- | ------------------ | \n| Основная | I1 | Гаплогруппа *снип* |`
};
console.log(matter.stringify('', data, { lineWidth: -1 }));
