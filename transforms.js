function multiply3(left, right) {
    const product = new Float32Array(9);

    for (let column = 0; column < 3; column++) {
        const offset = column * 3;
        const x = right[offset];
        const y = right[offset + 1];
        const z = right[offset + 2];

        for (let row = 0; row < 3; row++) {
            product[offset + row] = left[row] * x + left[row + 3] * y + left[row + 6] * z;
        }
    }

    return product;
}

function rotateX3(angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    return new Float32Array([
        1, 0, 0,
        0, cosine, -sine,
        0, sine, cosine
    ]);
}

function rotateY3(angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    return new Float32Array([
        cosine, 0, -sine,
        0, 1, 0,
        sine, 0, cosine
    ]);
}

function transformVec3(matrix, [x, y, z]) {
    return [
        matrix[0] * x + matrix[3] * y + matrix[6] * z,
        matrix[1] * x + matrix[4] * y + matrix[7] * z,
        matrix[2] * x + matrix[5] * y + matrix[8] * z
    ];
}
