import matter from 'gray-matter';
const data = {
  overview: `| Уровень | SNP | Описание |\n| ------------- | ---------------------------------------------------- | ------------------ |\n| Основная | I1 | Гаплогруппа *снип* |\n| Промежуточный | [I-Z2893](https://www.yfull.com/tree/I-Z2893/) | Субклад *снип* |\n| Терминальный | [I-FGC69149](https://www.yfull.com/tree/I-FGC69149/) | Терминальный снип |`
};
console.log(matter.stringify('', data, { lineWidth: 9999 }));
